import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { z } from "zod";
import { zColor } from "@remotion/zod-types";
import { SPRINGS, interpolateClamp } from "../utils/animation";
import { useLayoutScale, useTime } from "../utils/layout";
import { Box } from "../components/Box";
import { Text } from "../components/Text";

export const CallToActionSchema = z.object({
  buttonText: z.string().min(1),
  subText: z.string(),
  buttonColor: zColor(),
  buttonTextColor: zColor(),
  textColor: zColor(),
  backgroundColor: zColor(),
});

export type CallToActionProps = z.infer<typeof CallToActionSchema>;

/**
 * Minimal Call-To-Action (CTA) Composition.
 * Focuses on bouncy layout entrance, programmatic linear sheen sweep, and smooth exit.
 */
export const CallToAction: React.FC<CallToActionProps> = ({
  buttonText,
  subText,
  buttonColor,
  buttonTextColor,
  textColor,
  backgroundColor,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const { px } = useLayoutScale();
  const { sec } = useTime();

  // Button pop entry and exit springs
  const enter = spring({
    frame,
    fps,
    config: SPRINGS.bouncy,
  });

  const exit = spring({
    frame: Math.max(0, frame - (durationInFrames - sec(0.8))),
    fps,
    config: SPRINGS.smooth,
  });

  const scale = enter * (1 - exit);
  const opacity = enter * (1 - exit);
  const translateY = (1 - enter) * px(40) - exit * px(40);

  // Sheen progress: linear translation of shiny white gradient overlay
  // Starts sweep at 1.0s, finishes at 1.6s
  const sheenProgress = interpolateClamp(
    frame,
    [sec(1.0), sec(1.6)],
    [-150, 150]
  );

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
        gap={16}
        style={{
          transform: `translateY(${translateY}px) scale(${scale})`,
        }}
      >
        {/* Sub-text above the CTA button */}
        <Text
          as="p"
          size={24}
          weight={500}
          color={textColor}
          letterSpacing={0.5}
          style={{ opacity: 0.8, textAlign: "center" }}
        >
          {subText}
        </Text>

        {/* CTA Button container */}
        <Box
          paddingX={48}
          paddingY={20}
          borderRadius={12}
          backgroundColor={buttonColor}
          display="flex"
          justifyContent="center"
          alignItems="center"
          style={{
            position: "relative",
            overflow: "hidden", // crops sheen overlay
            cursor: "pointer",
            boxShadow: "0 10px 25px rgba(0, 0, 0, 0.15)",
          }}
        >
          {/* Sheen Overlay Layer */}
          <div
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              width: "50%",
              transform: `skewX(-25deg) translateX(${sheenProgress}%)`,
              background: "linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.4) 50%, rgba(255,255,255,0) 100%)",
              pointerEvents: "none",
            }}
          />

          <Text
            as="span"
            size={28}
            weight={700}
            color={buttonTextColor}
            letterSpacing={0.8}
          >
            {buttonText}
          </Text>
        </Box>
      </Box>
    </Box>
  );
};
