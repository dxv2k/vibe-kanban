import { useCallback, useState } from 'react';
import { filesApi, FileUploadResponse } from '@/lib/api';

export interface UploadedFile {
  file_name: string;
  file_path: string;
  size_bytes: number;
}

/**
 * Hook for handling file attachments in session follow-up messages.
 * Unlike useSessionAttachments (for images the agent can see),
 * this uploads files directly to the workspace working directory
 * for the agent to use as input files.
 */
export function useSessionFileAttachments(workspaceId: string | undefined) {
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const uploadFiles = useCallback(
    async (files: File[], targetPath?: string): Promise<FileUploadResponse[]> => {
      if (!workspaceId) return [];

      setIsUploading(true);
      setUploadError(null);
      const results: FileUploadResponse[] = [];

      for (const file of files) {
        try {
          const response = await filesApi.uploadToWorkspace(
            workspaceId,
            file,
            targetPath
          );
          results.push(response);
          setUploadedFiles((prev) => [
            ...prev,
            {
              file_name: response.file_name,
              file_path: response.file_path,
              size_bytes: response.size_bytes,
            },
          ]);
        } catch (error) {
          console.error('Failed to upload file:', error);
          setUploadError(
            error instanceof Error ? error.message : 'Failed to upload file'
          );
        }
      }

      setIsUploading(false);
      return results;
    },
    [workspaceId]
  );

  const clearUploadedFiles = useCallback(() => {
    setUploadedFiles([]);
    setUploadError(null);
  }, []);

  return {
    uploadFiles,
    uploadedFiles,
    isUploading,
    uploadError,
    clearUploadedFiles,
  };
}
