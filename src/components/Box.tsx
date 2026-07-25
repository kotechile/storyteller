import React from "react";
import { useLayoutScale } from "../utils/layout";

export interface BoxProps extends React.HTMLAttributes<HTMLDivElement> {
  width?: number | string;   // Base width in px (number scales, string literal transparently passed)
  height?: number | string;  // Base height in px
  padding?: number;          // Uniform padding in px (scaled)
  paddingX?: number;         // Horizontal padding in px (scaled)
  paddingY?: number;         // Vertical padding in px (scaled)
  margin?: number;           // Uniform margin in px (scaled)
  marginX?: number;          // Horizontal margin in px (scaled)
  marginY?: number;          // Vertical margin in px (scaled)
  gap?: number;              // Flex gap in px (scaled)
  borderRadius?: number;     // Border radius in px (scaled)
  borderWidth?: number;      // Border width in px (scaled)
  borderColor?: string;
  backgroundColor?: string;
  display?: React.CSSProperties["display"];
  flexDirection?: React.CSSProperties["flexDirection"];
  justifyContent?: React.CSSProperties["justifyContent"];
  alignItems?: React.CSSProperties["alignItems"];
  flexWrap?: React.CSSProperties["flexWrap"];
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  marginLeft?: number;
  marginRight?: number;
  marginTop?: number;
  marginBottom?: number;
}

/**
 * Resolution-independent container Box. Scales dimensions, paddings, margins,
 * borders, and gaps relative to reference width.
 */
export const Box: React.FC<BoxProps> = ({
  children,
  width,
  height,
  padding,
  paddingX,
  paddingY,
  margin,
  marginX,
  marginY,
  gap,
  borderRadius,
  borderWidth,
  borderColor,
  backgroundColor,
  display,
  flexDirection,
  justifyContent,
  alignItems,
  flexWrap,
  paddingLeft,
  paddingRight,
  paddingTop,
  paddingBottom,
  marginLeft,
  marginRight,
  marginTop,
  marginBottom,
  style,
  ...props
}) => {
  const { px } = useLayoutScale();

  const getScaled = (val?: number | string): string | number | undefined => {
    if (val === undefined) return undefined;
    if (typeof val === "string") return val;
    return px(val);
  };

  const boxStyle: React.CSSProperties = {
    display,
    flexDirection,
    justifyContent,
    alignItems,
    flexWrap,
    backgroundColor,
    borderColor,
    width: getScaled(width),
    height: getScaled(height),
    borderRadius: getScaled(borderRadius),
    borderWidth: getScaled(borderWidth),
    borderStyle: borderWidth ? "solid" : undefined,

    // Paddings
    ...(padding !== undefined && { padding: px(padding) }),
    ...(paddingX !== undefined && { paddingLeft: px(paddingX), paddingRight: px(paddingX) }),
    ...(paddingY !== undefined && { paddingTop: px(paddingY), paddingBottom: px(paddingY) }),
    ...(paddingLeft !== undefined && { paddingLeft: px(paddingLeft) }),
    ...(paddingRight !== undefined && { paddingRight: px(paddingRight) }),
    ...(paddingTop !== undefined && { paddingTop: px(paddingTop) }),
    ...(paddingBottom !== undefined && { paddingBottom: px(paddingBottom) }),

    // Margins
    ...(margin !== undefined && { margin: px(margin) }),
    ...(marginX !== undefined && { marginLeft: px(marginX), marginRight: px(marginX) }),
    ...(marginY !== undefined && { marginTop: px(marginY), marginBottom: px(marginY) }),
    ...(marginLeft !== undefined && { marginLeft: px(marginLeft) }),
    ...(marginRight !== undefined && { marginRight: px(marginRight) }),
    ...(marginTop !== undefined && { marginTop: px(marginTop) }),
    ...(marginBottom !== undefined && { marginBottom: px(marginBottom) }),

    // Flex gap
    ...(gap !== undefined && { gap: px(gap) }),

    ...style,
  };

  return (
    <div style={boxStyle} {...props}>
      {children}
    </div>
  );
};
