import React from 'react';
import { interpolate, useCurrentFrame, Img } from 'remotion';

interface TitleCardSceneProps {
  title: string;
  subtitle?: string;
  /** Duration in frames for this title card (default: 120 = 4s @ 30fps) */
  durationInFrames?: number;
  /** Optional company logo URL to reveal prominently on title card */
  logoUrl?: string;
}

/**
 * Opening title card that appears before the main content.
 * Splits the title on colon for a main title / subtitle layout.
 * Fades in gracefully then holds.
 */
export const TitleCardScene: React.FC<TitleCardSceneProps> = ({
  title,
  subtitle,
  durationInFrames = 120,
  logoUrl,
}) => {
  const frame = useCurrentFrame();

  // Split on colon if no explicit subtitle provided
  const colonIdx = title.indexOf(':');
  const mainTitle = subtitle ? title : (colonIdx > -1 ? title.substring(0, colonIdx).trim() : title);
  const sub = subtitle || (colonIdx > -1 ? title.substring(colonIdx + 1).trim() : '');

  // Fade-in over first 30 frames (1s)
  const fadeIn = interpolate(frame, [0, 30], [0, 1], { extrapolateRight: 'clamp' });
  // Fade-out over last 20 frames
  const fadeOut = interpolate(
    frame,
    [durationInFrames - 20, durationInFrames],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );
  const opacity = Math.min(fadeIn, fadeOut);

  // Subtle scale-in for title
  const titleScale = interpolate(frame, [0, 40], [0.92, 1], { extrapolateRight: 'clamp' });
  // Subtitle slides up slightly
  const subtitleY = interpolate(frame, [10, 40], [20, 0], { extrapolateRight: 'clamp' });

  // Logo animation: Smooth fade in & scale up above title
  const logoOpacity = interpolate(frame, [5, 30], [0, 1], { extrapolateRight: 'clamp' });
  const logoScale = interpolate(frame, [5, 35], [0.85, 1], { extrapolateRight: 'clamp' });

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: '#0f172a',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'Inter, system-ui, sans-serif',
        opacity,
        position: 'relative',
      }}
    >
      {/* Prominent Logo Reveal in Scene 0 */}
      {logoUrl && (
        <div
          style={{
            marginBottom: 32,
            opacity: logoOpacity,
            transform: `scale(${logoScale})`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Img
            src={logoUrl}
            style={{
              maxHeight: 140,
              maxWidth: 360,
              objectFit: 'contain',
              filter: 'drop-shadow(0 4px 20px rgba(99, 102, 241, 0.4))',
            }}
          />
        </div>
      )}
      {/* Decorative top line */}
      <div
        style={{
          position: 'absolute',
          top: '38%',
          left: '50%',
          transform: 'translateX(-50%)',
          width: interpolate(frame, [0, 30], [0, 120], { extrapolateRight: 'clamp' }),
          height: 2,
          background: 'linear-gradient(90deg, transparent, rgba(99, 102, 241, 0.6), rgba(139, 92, 246, 0.6), transparent)',
          borderRadius: 1,
        }}
      />

      {/* Main Title */}
      <h1
        style={{
          fontSize: 56,
          fontWeight: 700,
          color: '#FFFFFF',
          textAlign: 'center',
          maxWidth: '80%',
          margin: 0,
          lineHeight: 1.15,
          letterSpacing: '-0.02em',
          transform: `scale(${titleScale})`,
          textShadow: '0 2px 20px rgba(99, 102, 241, 0.3)',
        }}
      >
        {mainTitle}
      </h1>

      {/* Subtitle */}
      {sub && (
        <p
          style={{
            fontSize: 24,
            fontWeight: 400,
            color: 'rgba(255, 255, 255, 0.6)',
            textAlign: 'center',
            maxWidth: '70%',
            margin: '16px 0 0 0',
            lineHeight: 1.4,
            letterSpacing: '-0.01em',
            transform: `translateY(${subtitleY}px)`,
            opacity: interpolate(frame, [10, 40], [0, 1], { extrapolateRight: 'clamp' }),
          }}
        >
          {sub}
        </p>
      )}

      {/* Bottom decorative dot */}
      <div
        style={{
          marginTop: 48,
          width: 6,
          height: 6,
          borderRadius: '50%',
          backgroundColor: 'rgba(99, 102, 241, 0.5)',
          opacity: interpolate(frame, [40, 55], [0, 1], { extrapolateRight: 'clamp' }),
        }}
      />
    </div>
  );
};
