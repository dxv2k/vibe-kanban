use std::path::Path;
use std::process::{Child, Command};
use tokio::sync::Mutex;
use std::time::{Duration, Instant};
use thiserror::Error;
use tracing::{info, warn};

#[derive(Debug, Error)]
pub enum CodeServerError {
    #[error("Failed to spawn code-server: {0}")]
    SpawnFailed(String),
    #[error("No available ports in range {start}-{end}")]
    NoAvailablePort { start: u16, end: u16 },
    #[error("Failed to acquire lock: {0}")]
    LockError(String),
}

pub struct CodeServerService {
    inner: Mutex<CodeServerState>,
    config: CodeServerConfig,
}

struct CodeServerState {
    instance: Option<RunningInstance>,
}

struct RunningInstance {
    port: u16,
    process: Child,
    started_at: Instant,
    workspace_path: std::path::PathBuf,
}

#[derive(Clone)]
pub struct CodeServerConfig {
    pub executable_path: String,
    pub base_url: String,
    pub data_dir: String,
    pub port_start: u16,
    pub port_end: u16,
}

impl Default for CodeServerConfig {
    fn default() -> Self {
        Self {
            executable_path: std::env::var("CODE_SERVER_PATH")
                .unwrap_or_else(|_| "code-server".to_string()),
            base_url: std::env::var("CODE_SERVER_BASE_URL")
                .unwrap_or_else(|_| "http://127.0.0.1".to_string()),
            data_dir: std::env::var("CODE_SERVER_DATA_DIR").unwrap_or_else(|_| {
                dirs::home_dir()
                    .map(|h| h.join(".vibe-kanban/code-server").to_string_lossy().to_string())
                    .unwrap_or_else(|| "/tmp/vibe-kanban-code-server".to_string())
            }),
            port_start: std::env::var("CODE_SERVER_PORT_START")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(8080),
            port_end: std::env::var("CODE_SERVER_PORT_END")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(8180),
        }
    }
}

impl CodeServerService {
    pub fn new(config: CodeServerConfig) -> Self {
        Self {
            inner: Mutex::new(CodeServerState { instance: None }),
            config,
        }
    }

    /// Get URL for opening a folder in code-server
    /// Spawns instance if needed, reuses if same workspace, restarts if different workspace
    pub async fn get_url_for_folder(&self, folder_path: &Path) -> Result<String, CodeServerError> {
        let port = self.ensure_running(folder_path).await?;

        // code-server is started with the workspace path, so just return the base URL
        Ok(format!(
            "{}:{}",
            self.config.base_url, port
        ))
    }

    async fn ensure_running(&self, workspace_path: &Path) -> Result<u16, CodeServerError> {
        let mut state = self.inner.lock().await;

        // Check if instance is alive and matches workspace
        if let Some(ref mut instance) = state.instance {
            if Self::is_port_responsive(instance.port) {
                // Check if workspace matches
                if instance.workspace_path == workspace_path {
                    info!(
                        "Reusing existing code-server on port {} for workspace {:?} (uptime: {:?})",
                        instance.port,
                        workspace_path,
                        instance.started_at.elapsed()
                    );
                    return Ok(instance.port);
                } else {
                    // Different workspace - kill and respawn
                    info!(
                        "Workspace changed from {:?} to {:?}, restarting code-server",
                        instance.workspace_path,
                        workspace_path
                    );
                    let _ = instance.process.kill();
                    state.instance = None;
                }
            } else {
                // Dead - clean up
                warn!(
                    "Code-server on port {} is dead, respawning",
                    instance.port
                );
                let _ = instance.process.kill();
                state.instance = None;
            }
        }

        // Spawn new instance
        let port = self.find_available_port()?;
        info!("Spawning new code-server on port {} for workspace {:?}", port, workspace_path);

        let process = self.spawn_process(port, workspace_path)?;

        // Wait for startup
        tokio::time::sleep(Duration::from_millis(500)).await;

        // Verify it started
        if !Self::is_port_responsive(port) {
            warn!("Code-server may not have started successfully on port {}", port);
        }

        state.instance = Some(RunningInstance {
            port,
            process,
            started_at: Instant::now(),
            workspace_path: workspace_path.to_path_buf(),
        });

        info!("Code-server started successfully on port {}", port);
        Ok(port)
    }

    fn is_port_responsive(port: u16) -> bool {
        use std::net::{IpAddr, Ipv4Addr, SocketAddr};

        let addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)), port);
        std::net::TcpStream::connect_timeout(&addr, Duration::from_millis(100)).is_ok()
    }

    fn find_available_port(&self) -> Result<u16, CodeServerError> {
        for port in self.config.port_start..=self.config.port_end {
            if let Ok(listener) = std::net::TcpListener::bind(("0.0.0.0", port)) {
                drop(listener);
                return Ok(port);
            }
        }

        Err(CodeServerError::NoAvailablePort {
            start: self.config.port_start,
            end: self.config.port_end,
        })
    }

    fn spawn_process(&self, port: u16, workspace_path: &Path) -> Result<Child, CodeServerError> {
        // Create data directory if it doesn't exist
        let data_dir = std::path::Path::new(&self.config.data_dir);
        if !data_dir.exists() {
            std::fs::create_dir_all(data_dir).map_err(|e| {
                CodeServerError::SpawnFailed(format!("Failed to create data dir: {}", e))
            })?;
        }

        Command::new(&self.config.executable_path)
            .arg("--auth")
            .arg("none")
            .arg("--bind-addr")
            .arg(format!("0.0.0.0:{}", port))
            .arg("--user-data-dir")
            .arg(&self.config.data_dir)
            .arg(workspace_path)  // Pass workspace as final positional argument
            .env_remove("PORT")
            .spawn()
            .map_err(|e| CodeServerError::SpawnFailed(e.to_string()))
    }
}

impl Drop for CodeServerService {
    fn drop(&mut self) {
        if let Ok(mut state) = self.inner.try_lock() {
            if let Some(mut instance) = state.instance.take() {
                let _ = instance.process.kill();
                info!("Killed code-server on port {}", instance.port);
            }
        }
    }
}
