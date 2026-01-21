use std::path::PathBuf;

use axum::{
    Extension, Router,
    extract::{DefaultBodyLimit, Multipart, Query, State},
    middleware::from_fn_with_state,
    response::Json as ResponseJson,
    routing::post,
};
use db::models::workspace::Workspace;
use deployment::Deployment;
use serde::{Deserialize, Serialize};
use services::services::container::ContainerService;
use ts_rs::TS;
use utils::response::ApiResponse;

use crate::{DeploymentImpl, error::ApiError, middleware::load_workspace_middleware};

/// File upload size limit (50MB)
const FILE_SIZE_LIMIT: usize = 50 * 1024 * 1024;

#[derive(Debug, Deserialize)]
pub struct UploadFileQuery {
    /// Optional target path relative to workspace root (e.g., "src/data")
    /// If not provided, files are uploaded to the workspace root
    #[serde(default)]
    pub target_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, TS)]
pub struct FileUploadResponse {
    /// Name of the uploaded file
    pub file_name: String,
    /// Path where file was saved (relative to workspace)
    pub file_path: String,
    /// Size of the file in bytes
    pub size_bytes: u64,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
#[ts(tag = "type", rename_all = "snake_case")]
pub enum FileUploadError {
    NoFileProvided,
    InvalidFileName,
    PathTraversalAttempt,
    FileTooLarge { max_bytes: usize },
    WriteError { message: String },
}

/// Validate that a path component doesn't contain traversal attempts
fn is_safe_path_component(component: &str) -> bool {
    !component.is_empty()
        && component != "."
        && component != ".."
        && !component.contains('/')
        && !component.contains('\\')
        && !component.contains('\0')
}

/// Validate and sanitize the target path
fn validate_target_path(path: &str) -> Result<PathBuf, FileUploadError> {
    // Reject empty paths
    if path.is_empty() {
        return Ok(PathBuf::new());
    }

    // Reject absolute paths
    if path.starts_with('/') || path.starts_with('\\') {
        return Err(FileUploadError::PathTraversalAttempt);
    }

    // Check each component
    let path_buf = PathBuf::from(path);
    for component in path_buf.components() {
        match component {
            std::path::Component::Normal(c) => {
                if !is_safe_path_component(&c.to_string_lossy()) {
                    return Err(FileUploadError::PathTraversalAttempt);
                }
            }
            std::path::Component::ParentDir => {
                return Err(FileUploadError::PathTraversalAttempt);
            }
            std::path::Component::CurDir => {
                // Skip "." components
            }
            _ => {
                return Err(FileUploadError::PathTraversalAttempt);
            }
        }
    }

    Ok(path_buf)
}

/// Validate filename
fn validate_filename(filename: &str) -> Result<String, FileUploadError> {
    if filename.is_empty() {
        return Err(FileUploadError::InvalidFileName);
    }

    // Reject path separators in filename
    if filename.contains('/') || filename.contains('\\') {
        return Err(FileUploadError::InvalidFileName);
    }

    // Reject special names
    if filename == "." || filename == ".." {
        return Err(FileUploadError::InvalidFileName);
    }

    // Reject null bytes
    if filename.contains('\0') {
        return Err(FileUploadError::InvalidFileName);
    }

    Ok(filename.to_string())
}

/// Upload a file directly to the workspace's working directory.
/// This allows users to provide files for the agent to work with.
pub async fn upload_file(
    Extension(workspace): Extension<Workspace>,
    State(deployment): State<DeploymentImpl>,
    Query(query): Query<UploadFileQuery>,
    mut multipart: Multipart,
) -> Result<ResponseJson<ApiResponse<FileUploadResponse, FileUploadError>>, ApiError> {
    // Get workspace path
    let container_ref = deployment
        .container()
        .ensure_container_exists(&workspace)
        .await?;
    let workspace_path = PathBuf::from(container_ref);

    // Determine base path (workspace root or agent_working_dir)
    let base_path = match workspace.agent_working_dir.as_deref() {
        Some(dir) if !dir.is_empty() => workspace_path.join(dir),
        _ => workspace_path,
    };

    // Validate and apply target path
    let target_dir = if let Some(ref target_path) = query.target_path {
        let validated_path = match validate_target_path(target_path) {
            Ok(path) => path,
            Err(err) => {
                return Ok(ResponseJson(ApiResponse::error_with_data(err)));
            }
        };
        base_path.join(validated_path)
    } else {
        base_path
    };

    // Process multipart upload
    let field = multipart
        .next_field()
        .await
        .map_err(|e| ApiError::BadRequest(format!("Failed to read multipart field: {}", e)))?
        .ok_or_else(|| {
            ApiError::BadRequest("No file provided".to_string())
        })?;

    // Get filename
    let filename = field
        .file_name()
        .map(|s| s.to_string())
        .ok_or_else(|| ApiError::BadRequest("No filename provided".to_string()))?;

    let validated_filename = match validate_filename(&filename) {
        Ok(name) => name,
        Err(err) => {
            return Ok(ResponseJson(ApiResponse::error_with_data(err)));
        }
    };

    // Read file data
    let data = field
        .bytes()
        .await
        .map_err(|e| ApiError::BadRequest(format!("Failed to read file data: {}", e)))?;

    // Check file size (redundant with layer limit but good for explicit error)
    if data.len() > FILE_SIZE_LIMIT {
        return Ok(ResponseJson(ApiResponse::error_with_data(
            FileUploadError::FileTooLarge {
                max_bytes: FILE_SIZE_LIMIT,
            },
        )));
    }

    // Ensure target directory exists
    tokio::fs::create_dir_all(&target_dir)
        .await
        .map_err(|e| {
            tracing::error!("Failed to create target directory {:?}: {}", target_dir, e);
            ApiError::BadRequest(format!("Failed to create target directory: {}", e))
        })?;

    // Write file
    let file_path = target_dir.join(&validated_filename);
    tokio::fs::write(&file_path, &data).await.map_err(|e| {
        tracing::error!("Failed to write file {:?}: {}", file_path, e);
        ApiError::BadRequest(format!("Failed to write file: {}", e))
    })?;

    // Calculate relative path for response
    let relative_path = if let Some(ref target_path) = query.target_path {
        format!("{}/{}", target_path, validated_filename)
    } else {
        validated_filename.clone()
    };

    tracing::info!(
        "Uploaded file '{}' to workspace {} at {}",
        validated_filename,
        workspace.id,
        file_path.display()
    );

    deployment
        .track_if_analytics_allowed(
            "workspace_file_uploaded",
            serde_json::json!({
                "workspace_id": workspace.id.to_string(),
                "file_name": validated_filename,
                "size_bytes": data.len(),
            }),
        )
        .await;

    Ok(ResponseJson(ApiResponse::success(FileUploadResponse {
        file_name: validated_filename,
        file_path: relative_path,
        size_bytes: data.len() as u64,
    })))
}

pub fn router(deployment: &DeploymentImpl) -> Router<DeploymentImpl> {
    Router::new()
        .route(
            "/upload",
            post(upload_file).layer(DefaultBodyLimit::max(FILE_SIZE_LIMIT)),
        )
        .layer(from_fn_with_state(
            deployment.clone(),
            load_workspace_middleware,
        ))
}
