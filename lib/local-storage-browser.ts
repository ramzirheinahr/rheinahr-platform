// Browser uploads use short-lived capabilities issued by authorized server actions.
// The browser never receives a filesystem path or a long-lived storage secret.
export function createLocalStorageBrowserClient() {
  return {
    storage: {
      from(_bucket: string) {
        return {
          async uploadToSignedUrl(
            _path: string,
            token: string,
            body: File | Blob,
            options?: { contentType?: string },
          ) {
            try {
              const response = await fetch(`/api/local-storage/upload?token=${encodeURIComponent(token)}`, {
                method: "PUT",
                headers: { "Content-Type": options?.contentType || body.type || "application/octet-stream" },
                body,
                credentials: "same-origin",
              });
              if (!response.ok) return { data: null, error: new Error(`Upload failed (${response.status})`) };
              return { data: await response.json(), error: null };
            } catch (error) {
              return { data: null, error: error instanceof Error ? error : new Error(String(error)) };
            }
          },
          getPublicUrl(objectPath: string) {
            if (!objectPath || objectPath.split("/").some((part) => !part || part === "." || part === "..")) {
              throw new Error("Invalid storage path");
            }
            return { data: { publicUrl: `/api/local-storage/public/system-assets/${objectPath.split("/").map(encodeURIComponent).join("/")}` } };
          },
        };
      },
    },
  };
}
