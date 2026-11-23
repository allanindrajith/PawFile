import { useEffect, useState } from 'react';
import { supabase } from './supabase.js';

const BUCKET = 'pet-photos';
const urlCache = new Map(); // path -> { url, until }

/** Shrink a phone photo to a 720px JPEG so uploads are quick and the bucket stays small. */
export async function resizeToJpeg(file, max = 720) {
  if (!file?.type?.startsWith('image/')) throw new Error('PHOTO_TYPE');
  if (file.size > 15 * 1024 * 1024) throw new Error('PHOTO_BIG');
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PHOTO_TYPE'))), 'image/jpeg', 0.85));
}

/** Upload a photo for a pet and save its path on the pet row. Returns the new path. */
export async function uploadPetPhoto(petId, file) {
  const blob = await resizeToJpeg(file);
  const path = `${petId}/${Date.now()}.jpg`;
  const up = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg' });
  if (up.error) throw up.error;
  const { error } = await supabase.from('pets').update({ photo_path: path }).eq('id', petId);
  if (error) throw error;
  return path;
}

/** Photos are private; ask for a short-lived link and reuse it for most of its life. */
export async function signedPhotoUrl(path) {
  const hit = urlCache.get(path);
  if (hit && hit.until > Date.now()) return hit.url;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error) throw error;
  urlCache.set(path, { url: data.signedUrl, until: Date.now() + 50 * 60 * 1000 });
  return data.signedUrl;
}

/** React hook: the displayable URL for a stored photo path, or null while loading / when there is none. */
export function usePhotoUrl(path) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let live = true;
    setUrl(null);
    if (path && supabase) signedPhotoUrl(path).then((u) => live && setUrl(u)).catch(() => {});
    return () => { live = false; };
  }, [path]);
  return url;
}
