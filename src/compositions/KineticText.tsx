import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { z } from "zod";
import { zColor } from "@remotion/zod-types";
import { SPRINGS } from "../utils/animation";
import { useLayoutScale, useTime } from "../utils/layout";
import { Box } from "../components/Box";
import { Text } from "../components/Text";

export const KineticTextSchema = z.object({
  text: z.string().min(1),
  textColor: zColor(),
  accentColor: zColor(),
  backgroundColor: zColor(),
});

export type KineticTextProps = z.infer<typeof KineticTextSchema>;

/**
 * Kinetic typography composition.
 * Animates text word-by-word with staggered enter and exit physics.
 */
export const KineticText: React.FC<KineticTextProps> = ({
  text,
  textColor,
  accentColor,
  backgroundColor,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const { px } = useLayoutScale();
  const { sec } = useTime();

  const words = text.split(/\s+/);

  return (
    <Box
      width="100%"
      height="100%"
      backgroundColor={backgroundColor}
      display="flex"
      justifyContent="center"
      alignItems="center"
      padding={48}
    >
      {/* Wrap container with max layout width */}
      <Box
        display="flex"
        flexWrap="wrap"
        justifyContent="center"
        gap={16}
        style={{ maxWidth: px(1100), textAlign: "center" }}
      >
        {words.map((word, index) => {
          // Stagger timings calculated in frames using the sec() helper
          const enterDelay = index * sec(0.12);
          const exitDelay = (words.length - 1 - index) * sec(0.08);
          const exitStartFrame = durationInFrames - sec(0.8) - exitDelay;

          const enter = spring({
            frame: Math.max(0, frame - enterDelay),
            fps,
            config: SPRINGS.bouncy,
          });

          const exit = spring({
            frame: Math.max(0, frame - exitStartFrame),
            fps,
            config: SPRINGS.smooth,
          });

          const opacity = enter * (1 - exit);
          const scale = 0.8 + 0.2 * enter - 0.2 * exit;
          const translateY = (1 - enter) * px(30) - exit * px(30);

          // Accent formatting for particular keywords or the last word
          const isAccent =
            index === words.length - 1 ||
            word.toLowerCase().includes("creative") ||
            word.toLowerCase().includes("video") ||
            word.toLowerCase().includes("engine");

          const wordColor = isAccent ? accentColor : textColor;

          return (
            <Text
              key={index}
              as="span"
              size={56}
              weight={900}
              color={wordColor}
              style={{
                display: "inline-block",
                transform: `translateY(${translateY}px) scale(${scale})`,
                opacity,
                transformOrigin: "center center",
              }}
            >
              {word}
            </Text>
          );
        })}
      </Box>
    </Box>
  );
};
