import { apiFetch } from "../api-client";

export function uploadEditorImage(file: File) {
  const formData = new FormData();
  formData.append("image", file);
  return apiFetch<{ url: string }>("/api/uploads/editor-image", {
    method: "POST",
    body: formData,
    isFormData: true,
  }).then((res) => res.url);
}
