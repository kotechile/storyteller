import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { z } from "zod";
import { zColor } from "@remotion/zod-types";
import { SPRINGS } from "../utils/animation";
import { useLayoutScale, useTime } from "../utils/layout";
import { Box } from "../components/Box";
import { Text } from "../components/Text";

export const TitleCardSchema = z.object({
  titleText: z.string().min(1),
  subtitleText: z.string(),
  titleColor: zColor(),
  subtitleColor: zColor(),
  backgroundColor: zColor(),
});

export type TitleCardProps = z.infer<typeof TitleCardSchema>;

/**
 * Responsive Minimal Title Card.
 * Focuses on flawless layout physics and timeline transitions.
 */
export const TitleCard: React.FC<TitleCardProps> = ({
  titleText,
  subtitleText,
  titleColor,
  subtitleColor,
  backgroundColor,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const { px } = useLayoutScale();
  const { sec } = useTime();

  // Snappy enter spring, smooth exit spring
  const enter = spring({
    frame,
    fps,
    config: SPRINGS.smooth,
  });

  const exit = spring({
    frame: Math.max(0, frame - (durationInFrames - sec(0.8))),
    fps,
    config: SPRINGS.gentle,
  });

  // Calculate compound transitions
  const opacity = enter * (1 - exit);
  // Slides up by 60px (scaled) on enter, slides up further by 60px (scaled) on exit
  const translateY = (1 - enter) * px(60) - exit * px(60);

  return (
    <Box
      width="100%"
      height="100%"
      backgroundColor={backgroundColor}
      display="flex"
      flexDirection="column"
      justifyContent="center"
      alignItems="center"
      padding={48}
      style={{
        opacity,
      }}
    >
      <Box
        display="flex"
        flexDirection="column"
        alignItems="center"
        style={{
          transform: `translateY(${translateY}px)`,
        }}
      >
        {/* Title */}
        <Text
          as="h1"
          size={72}
          weight={800}
          letterSpacing={-1.5}
          lineHeight={84}
          color={titleColor}
          style={{ textAlign: "center" }}
        >
          {titleText}
        </Text>

        {/* Minimal Divider line */}
        <Box
          width={96}
          height={4}
          borderRadius={2}
          backgroundColor={subtitleColor}
          marginY={24}
          style={{ opacity: 0.5 }}
        />

        {/* Subtitle */}
        <Text
          as="p"
          size={28}
          weight={500}
          letterSpacing={2}
          color={subtitleColor}
          style={{ textAlign: "center" }}
        >
          {subtitleText}
        </Text>
      </Box>
    </Box>
  );
};
