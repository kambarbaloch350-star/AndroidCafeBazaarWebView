import JSZip from 'jszip';
import { ALL_EXPORT_FILES } from '../data/exportFiles';

export async function downloadAndroidProjectZip(
  onProgress?: (percent: number, status: string) => void
): Promise<void> {
  const zip = new JSZip();

  onProgress?.(10, 'Preparing Android Studio project files...');

  ALL_EXPORT_FILES.forEach((file, index) => {
    zip.file(file.path, file.content);
    const pct = Math.round(10 + (index / ALL_EXPORT_FILES.length) * 65);
    onProgress?.(pct, `Packaging ${file.path}...`);
  });

  try {
    onProgress?.(78, 'Checking gradle-wrapper.jar binary...');
    const jarResponse = await fetch('/gradle/wrapper/gradle-wrapper.jar');
    if (jarResponse.ok) {
      const jarBuffer = await jarResponse.arrayBuffer();
      zip.file('gradle/wrapper/gradle-wrapper.jar', jarBuffer);
    }
  } catch (err) {
    console.warn('Could not load local wrapper jar into zip:', err);
  }

  onProgress?.(85, 'Compressing project archive with DEFLATE...');

  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 }
  });

  onProgress?.(95, 'Initiating download...');

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'QuickGames-Android-Adivery-CafeBazaar.zip';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  onProgress?.(100, 'Download complete!');
}
