import JSZip from 'jszip';
import { ALL_EXPORT_FILES } from '../data/exportFiles';

export async function downloadAndroidProjectZip(
  onProgress?: (percent: number, status: string) => void
): Promise<void> {
  const zip = new JSZip();

  onProgress?.(10, 'Preparing Android Studio project files...');

  // Add all text/source files into the zip archive maintaining directory hierarchy
  ALL_EXPORT_FILES.forEach((file, index) => {
    zip.file(file.path, file.content);
    const pct = Math.round(10 + (index / ALL_EXPORT_FILES.length) * 60);
    onProgress?.(pct, `Packaging ${file.path}...`);
  });

  // Include the Gradle Wrapper binary jar directly in the zip
  try {
    onProgress?.(72, 'Including gradle-wrapper.jar binary...');
    const jarResponse = await fetch('/gradle/wrapper/gradle-wrapper.jar');
    if (jarResponse.ok) {
      const jarBuffer = await jarResponse.arrayBuffer();
      zip.file('gradle/wrapper/gradle-wrapper.jar', jarBuffer);
    }
  } catch (err) {
    console.warn('Could not load local wrapper jar into zip:', err);
  }

  onProgress?.(80, 'Compressing project archive...');
  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 }
  });

  onProgress?.(95, 'Initiating download...');

  // Trigger browser download
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'AndroidCafeBazaarWebView-Studio-Project.zip';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  onProgress?.(100, 'Download complete!');
}
