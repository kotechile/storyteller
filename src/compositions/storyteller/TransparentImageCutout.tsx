import React, { useEffect, useState } from 'react';
import { Img } from 'remotion';

interface TransparentImageCutoutProps {
  src: string;
  style?: React.CSSProperties;
  preserveBackground?: boolean;
}

/**
 * Removes white and light-gray background pixels from an image in real-time,
 * producing a 100% true transparent PNG cutout floating seamlessly on canvas.
 * Set preserveBackground=true to skip transparency (for infographic diagrams).
 */
export const TransparentImageCutout: React.FC<TransparentImageCutoutProps> = ({ src, style, preserveBackground = false }) => {
  const [transparentDataUrl, setTransparentDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    // If src is empty or invalid, avoid setting image src
    if (!src || src.trim() === '') {
      setTransparentDataUrl(null);
      return;
    }

    // Check if src is valid URL or data URI before loading Image
    if (!src.startsWith('http') && !src.startsWith('data:') && !src.startsWith('/')) {
      setTransparentDataUrl(null);
      return;
    }

    // SVG data URLs or preserveBackground mode don't need background removal
    if (src.startsWith('data:image/svg+xml') || preserveBackground) {
      setTransparentDataUrl(src);
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = src;

    img.onload = () => {
      if (!isMounted) return;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');

        if (!ctx) {
          setTransparentDataUrl(src);
          return;
        }

        ctx.drawImage(img, 0, 0);
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imgData.data;

        // Key out white/light-gray background pixels (R, G, B > 225)
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];

          // Check if pixel is white, off-white, or light gray vignette/shadow
          if (r > 225 && g > 225 && b > 225) {
            data[i + 3] = 0; // 100% transparent!
          } else if (r > 205 && g > 205 && b > 205) {
            // Feather edge pixels for smooth anti-aliased cutout
            const avg = (r + g + b) / 3;
            const alphaFactor = Math.max(0, (225 - avg) / 20);
            data[i + 3] = Math.round(data[i + 3] * alphaFactor);
          }
        }

        ctx.putImageData(imgData, 0, 0);
        const dataUrl = canvas.toDataURL('image/png');
        setTransparentDataUrl(dataUrl);
      } catch (err) {
        console.warn('[TransparentImageCutout] Canvas processing fallback to original image:', err);
        setTransparentDataUrl(src);
      }
    };

    img.onerror = () => {
      if (isMounted) setTransparentDataUrl(src);
    };

    return () => {
      isMounted = false;
    };
  }, [src]);

  const finalSrc = transparentDataUrl || src;
  if (!finalSrc || finalSrc.trim() === '') return null;

  return (
    <Img
      src={finalSrc}
      style={{
        maxWidth: '100%',
        maxHeight: '100%',
        width: 'auto',
        height: 'auto',
        objectFit: 'contain',
        filter: 'drop-shadow(0 8px 18px rgba(15, 23, 42, 0.12))',
        ...style,
      }}
    />
  );
};
