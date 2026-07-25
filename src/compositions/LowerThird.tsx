import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { z } from "zod";
import { zColor } from "@remotion/zod-types";
import { SPRINGS } from "../utils/animation";
import { useLayoutScale, useTime } from "../utils/layout";
import { Box } from "../components/Box";
import { Text } from "../components/Text";

export const LowerThirdSchema = z.object({
  primaryName: z.string().min(1),
  secondaryTitle: z.string(),
  textColor: zColor(),
  accentColor: zColor(),
  panelColor: zColor(),
});

export type LowerThirdProps = z.infer<typeof LowerThirdSchema>;

/**
 * Responsive Lower Third composition.
 * Combines scaled width adjustments with staggered enter/exit physics.
 */
export const LowerThird: React.FC<LowerThirdProps> = ({
  primaryName,
  secondaryTitle,
  textColor,
  accentColor,
  panelColor,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const { px } = useLayoutScale();
  const { sec } = useTime();

  // Panel timelines: scale in from left
  const panelEnter = spring({
    frame,
    fps,
    config: SPRINGS.smooth,
  });

  const panelExit = spring({
    frame: Math.max(0, frame - (durationInFrames - sec(0.8))),
    fps,
    config: SPRINGS.smooth,
  });

  // Text timelines: slide up (staggered delay)
  const textEnter = spring({
    frame: Math.max(0, frame - sec(0.3)),
    fps,
    config: SPRINGS.gentle,
  });

  const textExit = spring({
    frame: Math.max(0, frame - (durationInFrames - sec(1.0))),
    fps,
    config: SPRINGS.gentle,
  });

  const panelScaleX = panelEnter * (1 - panelExit);
  const textOpacity = textEnter * (1 - textExit);
  
  // Slide percentage: 100% (hidden below) -> 0% (visible) -> 100% (hidden below on exit)
  const textTranslateY = (1 - textEnter) * 100 + textExit * 100;

  return (
    <Box
      width="100%"
      height="100%"
      padding={96}
      display="flex"
      alignItems="flex-end"
      justifyContent="flex-start"
    >
      <Box display="flex" style={{ position: "relative" }}>
        
        {/* Accent Bar */}
        <Box
          width={8}
          height={80}
          backgroundColor={accentColor}
          borderRadius={4}
          style={{
            transform: `scaleY(${panelScaleX})`,
            transformOrigin: "center",
            position: "absolute",
            left: 0,
            top: 0,
          }}
        />

        {/* Text Panel Container */}
        <Box
          height={80}
          backgroundColor={panelColor}
          paddingLeft={32}
          paddingRight={48}
          borderRadius={8}
          display="flex"
          flexDirection="column"
          justifyContent="center"
          style={{
            transform: `scaleX(${panelScaleX})`,
            transformOrigin: "left center",
            marginLeft: px(12),
            overflow: "hidden", // masks text slide
          }}
        >
          {/* Moving Content Area */}
          <Box
            display="flex"
            flexDirection="column"
            style={{
              transform: `translateY(${textTranslateY}%)`,
              opacity: textOpacity,
            }}
          >
            <Text
              as="span"
              size={28}
              weight={700}
              color={textColor}
              letterSpacing={0.5}
            >
              {primaryName}
            </Text>
            
            <Text
              as="span"
              size={16}
              weight={600}
              color={accentColor}
              letterSpacing={1.5}
              style={{ textTransform: "uppercase", marginTop: px(2) }}
            >
              {secondaryTitle}
            </Text>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};
