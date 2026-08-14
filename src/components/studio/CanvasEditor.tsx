import React, { useState, useRef } from 'react';
import { CanvasElement } from '../../types/storyboard';

interface CanvasEditorProps {
  elements: CanvasElement[];
  selectedElementId: string | null;
  onSelectElement: (elementId: string | null) => void;
  onUpdateElementPosition: (elementId: string, patch: { x: number; y: number; width: number; height: number }) => void;
}

export const CanvasEditor: React.FC<CanvasEditorProps> = ({
  elements,
  selectedElementId,
  onSelectElement,
  onUpdateElementPosition,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragState, setDragState] = useState<{
    elementId: string;
    startX: number;
    startY: number;
    initialElemX: number;
    initialElemY: number;
    initialElemWidth: number;
    initialElemHeight: number;
    type: 'move' | 'resize';
  } | null>(null);

  const handleMouseDown = (e: React.MouseEvent, el: CanvasElement, type: 'move' | 'resize') => {
    e.stopPropagation();
    onSelectElement(el.id);

    setDragState({
      elementId: el.id,
      startX: e.clientX,
      startY: e.clientY,
      initialElemX: el.x,
      initialElemY: el.y,
      initialElemWidth: el.width,
      initialElemHeight: el.height,
      type,
    });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragState || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const deltaXPercent = ((e.clientX - dragState.startX) / rect.width) * 100;
    const deltaYPercent = ((e.clientY - dragState.startY) / rect.height) * 100;

    const targetElem = elements.find((el) => el.id === dragState.elementId);
    if (!targetElem) return;

    if (dragState.type === 'move') {
      const newX = Math.max(2, Math.min(94 - targetElem.width, dragState.initialElemX + deltaXPercent));
      const newY = Math.max(2, Math.min(92 - targetElem.height, dragState.initialElemY + deltaYPercent));
      onUpdateElementPosition(targetElem.id, {
        x: Math.round(newX * 10) / 10,
        y: Math.round(newY * 10) / 10,
        width: targetElem.width,
        height: targetElem.height,
      });
    } else if (dragState.type === 'resize') {
      const minWidth = 8;
      const minHeight = 6;
      const newWidth = Math.max(minWidth, dragState.initialElemWidth + deltaXPercent);
      const newHeight = Math.max(minHeight, dragState.initialElemHeight + deltaYPercent);
      onUpdateElementPosition(targetElem.id, {
        x: targetElem.x,
        y: targetElem.y,
        width: Math.round(newWidth * 10) / 10,
        height: Math.round(newHeight * 10) / 10,
      });
    }
  };

  const handleMouseUp = () => {
    setDragState(null);
  };

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onClick={() => onSelectElement(null)}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 50,
        pointerEvents: 'auto',
      }}
    >
      {elements.map((el) => {
        const isSelected = el.id === selectedElementId;
        if (el.type === 'connector') return null;

        return (
          <div
            key={el.id}
            onMouseDown={(e) => handleMouseDown(e, el, 'move')}
            style={{
              position: 'absolute',
              left: `${el.x}%`,
              top: `${el.y}%`,
              width: `${el.width}%`,
              height: `${el.height}%`,
              zIndex: (el.zIndex || 1) + 20,
              boxSizing: 'border-box',
              border: isSelected ? '2px solid #4F46E5' : 'none',
              backgroundColor: isSelected ? 'rgba(79, 70, 229, 0.06)' : 'transparent',
              borderRadius: '8px',
              cursor: dragState?.type === 'move' ? 'grabbing' : 'grab',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {isSelected && (
              <div
                onMouseDown={(e) => handleMouseDown(e, el, 'resize')}
                style={{
                  position: 'absolute',
                  right: '-6px',
                  bottom: '-6px',
                  width: '12px',
                  height: '12px',
                  backgroundColor: '#4F46E5',
                  borderRadius: '3px',
                  cursor: 'nwse-resize',
                  border: '2px solid #FFFFFF',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
};
