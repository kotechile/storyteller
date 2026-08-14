import React from 'react';
import { createRoot } from 'react-dom/client';
import { StoryStudio } from './components/studio/StoryStudio';
import './index.css';

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <StoryStudio />
    </React.StrictMode>
  );
}
