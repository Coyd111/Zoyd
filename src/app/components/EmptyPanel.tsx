import React from 'react';

interface EmptyPanelProps {
  icon: React.ReactNode;
  image?: string;
  title: string;
  body: string;
}

const EmptyPanel: React.FC<EmptyPanelProps> = ({ icon, image, title, body }) => (
  <div className="hud-panel p-8 text-center bg-zoyd-surface/20 overflow-hidden relative">
    {image && (
      <div className="absolute inset-0 opacity-[0.06]">
        <img src={image} alt="" loading="lazy" className="w-full h-full object-cover" />
      </div>
    )}
    <div className="relative mx-auto mb-4 flex w-12 h-12 items-center justify-center">{icon}</div>
    <p className="relative font-display font-black uppercase italic text-white mb-2">{title}</p>
    <p className="relative text-sm text-white/30 max-w-xl mx-auto">{body}</p>
  </div>
);

export default EmptyPanel;
