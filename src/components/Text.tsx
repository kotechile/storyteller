import React from "react";
import { useLayoutScale } from "../utils/layout";

export interface TextProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: number;             // Base font size in pixels (for 1920x1080 layout)
  weight?: React.CSSProperties["fontWeight"];
  lineHeight?: number;       // Line height (e.g. 1.2 or 32 for absolute px)
  letterSpacing?: number;    // Letter spacing in px (for 1920x1080 layout)
  color?: string;
  fontFamily?: string;
  as?: "h1" | "h2" | "h3" | "p" | "span" | "div";
}

/**
 * Resolution-independent Text component. Scales font size, line height,
 * and letter spacing relative to base width.
 */
export const Text: React.FC<TextProps> = ({
  children,
  size = 24,
  weight = "normal",
  lineHeight,
  letterSpacing,
  color,
  fontFamily = "Outfit, sans-serif",
  as = "div",
  style,
  ...props
}) => {
  const { px } = useLayoutScale();
  const Component: React.ElementType = as;

  const textStyle: React.CSSProperties = {
    fontSize: px(size),
    fontWeight: weight,
    fontFamily,
    color,
    ...(lineHeight !== undefined && {
      lineHeight: lineHeight > 3 ? `${px(lineHeight)}px` : lineHeight,
    }),
    ...(letterSpacing !== undefined && {
      letterSpacing: `${px(letterSpacing)}px`,
    }),
    ...style,
  };

  return (
    <Component style={textStyle} {...props}>
      {children}
    </Component>
  );
};
