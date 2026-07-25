import React from "react";
import { spring, useCurrentFrame, useVideoConfig, Audio, staticFile, Sequence } from "remotion";
import { z } from "zod";
import { zColor } from "@remotion/zod-types";
import { SPRINGS } from "../utils/animation";
import { useLayoutScale, useTime } from "../utils/layout";
import { Box } from "../components/Box";
import { Text } from "../components/Text";

export const TransparentOverlaySchema = z.object({
  badgeText: z.string().min(1),
  categoryText: z.string(),
  badgeColor: zColor(),
  textColor: zColor(),
  borderColor: zColor(),
  playSoundEffect: z.boolean(),
});

export type TransparentOverlayProps = z.infer<typeof TransparentOverlaySchema>;

/**
 * Glassmorphic Transparent Overlay Composition.
 * Designed to render as alpha-channel media overlay (ProRes 4444).
 */
export const TransparentOverlay: React.FC<TransparentOverlayProps> = ({
  badgeText,
  categoryText,
  badgeColor,
  textColor,
  borderColor,
  playSoundEffect,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const { px } = useLayoutScale();
  const { sec } = useTime();

  // Enter/Exit spring curves
  const scaleEnter = spring({
    frame,
    fps,
    config: SPRINGS.snappy,
  });

  const scaleExit = spring({
    frame: Math.max(0, frame - (durationInFrames - sec(0.6))),
    fps,
    config: SPRINGS.snappy,
  });

  const scale = scaleEnter * (1 - scaleExit);
  // Spin entry: 12 degrees -> 0 degrees -> -12 degrees on exit
  const rotate = (1 - scaleEnter) * 12 - scaleExit * 12;
  const opacity = scaleEnter * (1 - scaleExit);

  // Programmatic, frame-perfect indicator pulse.
  // Visualizes a blinking indicator pulsing at 1Hz, completely synced with renderer.
  const pulseOpacity = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin((frame / fps) * Math.PI * 2));

  return (
    <Box
      width="100%"
      height="100%"
      padding={48}
      display="flex"
      justifyContent="flex-start"
      alignItems="flex-start"
      backgroundColor="transparent"
    >
      {/* Optional Pop Sound Effect */}
      {playSoundEffect && (
        <Sequence from={sec(0.1)}>
          <Audio src={staticFile("audio/pop.mp3")} volume={0.8} />
        </Sequence>
      )}

      {/* Floating Badge container */}
      <Box
        paddingX={24}
        paddingY={16}
        borderRadius={12}
        borderWidth={2}
        borderColor={borderColor}
        backgroundColor={badgeColor}
        display="flex"
        alignItems="center"
        gap={12}
        style={{
          transform: `scale(${scale}) rotate(${rotate}deg)`,
          transformOrigin: "left center",
          opacity,
          backdropFilter: "blur(12px)",
          boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
        }}
      >
        {/* Blinking status node */}
        <Box
          width={14}
          height={14}
          borderRadius={7}
          backgroundColor={borderColor}
          style={{
            opacity: pulseOpacity,
          }}
        />

        <Box display="flex" flexDirection="column">
          <Text
            as="span"
            size={12}
            weight={700}
            color={textColor}
            letterSpacing={1.5}
            style={{ textTransform: "uppercase", opacity: 0.7, lineHeight: 1 }}
          >
            {categoryText}
          </Text>
          <Text
            as="span"
            size={18}
            weight={800}
            color={textColor}
            letterSpacing={0.5}
            style={{ marginTop: px(4), lineHeight: 1 }}
          >
            {badgeText}
          </Text>
        </Box>
      </Box>
    </Box>
  );
};
