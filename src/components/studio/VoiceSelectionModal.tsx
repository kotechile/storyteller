import React, { useState, useMemo } from 'react';
import { VoiceEntry } from '../../lib/voiceLibrary';
import { useVoicePlayer } from '../../hooks/useVoicePlayer';

interface VoiceSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  voices: VoiceEntry[];
  selectedVoiceId: string;
  onSelectVoice: (voiceId: string) => void;
  onAddCustomVoice?: (voiceId: string, name: string) => void;
}

export const VoiceSelectionModal: React.FC<VoiceSelectionModalProps> = ({
  isOpen,
  onClose,
  voices,
  selectedVoiceId,
  onSelectVoice,
  onAddCustomVoice,
}) => {
  const [draftSelection, setDraftSelection] = useState(selectedVoiceId);
  const [searchQuery, setSearchQuery] = useState('');
  const [genderFilter, setGenderFilter] = useState<'all' | 'male' | 'female'>('all');
  const [customVoiceId, setCustomVoiceId] = useState('');
  const [customVoiceName, setCustomVoiceName] = useState('');
  const [showAddCustom, setShowAddCustom] = useState(false);

  const { playingId, togglePlay, stopAudio } = useVoicePlayer();

  // Reset draft selection on modal open
  React.useEffect(() => {
    if (isOpen) {
      setDraftSelection(selectedVoiceId);
      setSearchQuery('');
    } else {
      stopAudio();
    }
  }, [isOpen, selectedVoiceId, stopAudio]);

  const filteredVoices = useMemo(() => {
    return voices.filter((voice) => {
      const matchesSearch =
        voice.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        voice.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        voice.tags?.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchesGender = genderFilter === 'all' || voice.gender === genderFilter;

      return matchesSearch && matchesGender;
    });
  }, [voices, searchQuery, genderFilter]);

  if (!isOpen) return null;

  const handleConfirm = () => {
    onSelectVoice(draftSelection);
    stopAudio();
    onClose();
  };

  const handleCreateCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customVoiceId.trim()) return;
    if (onAddCustomVoice) {
      onAddCustomVoice(customVoiceId.trim(), customVoiceName.trim() || 'Custom Voice');
      setCustomVoiceId('');
      setCustomVoiceName('');
      setShowAddCustom(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        backgroundColor: 'rgba(15, 23, 42, 0.5)',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div
        style={{
          backgroundColor: '#FFFFFF',
          width: '100%',
          maxWidth: '560px',
          borderRadius: '16px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
          border: '1px solid #E2E8F0',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '82vh',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '20px 24px',
            borderBottom: '1px solid #F1F5F9',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: '#FFFFFF',
          }}
        >
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#0F172A', margin: 0, letterSpacing: '-0.01em' }}>
              Select AI Narrator Voice
            </h2>
            <p style={{ fontSize: '12px', color: '#64748B', margin: '4px 0 0 0' }}>
              Choose a voice profile for instant text-to-speech audio generation
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              stopAudio();
              onClose();
            }}
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '9999px',
              border: 'none',
              backgroundColor: '#F1F5F9',
              color: '#64748B',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            ✕
          </button>
        </div>

        {/* Filters & Search Toolbar */}
        <div
          style={{
            padding: '14px 24px',
            borderBottom: '1px solid #F1F5F9',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            backgroundColor: '#F8FAFC',
          }}
        >
          <div style={{ position: 'relative', flex: 1 }}>
            <input
              type="text"
              placeholder="Search voices, styles, tags..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                paddingLeft: '34px',
                paddingRight: '12px',
                paddingTop: '8px',
                paddingBottom: '8px',
                backgroundColor: '#FFFFFF',
                border: '1px solid #CBD5E1',
                borderRadius: '8px',
                fontSize: '12px',
                color: '#0F172A',
                boxSizing: 'border-box',
                outline: 'none',
              }}
            />
            <span style={{ position: 'absolute', left: '10px', top: '8px', fontSize: '12px', color: '#94A3B8' }}>
              🔍
            </span>
          </div>

          {/* Gender Filter Segmented Control */}
          <div style={{ display: 'flex', backgroundColor: '#E2E8F0', padding: '3px', borderRadius: '8px', flexShrink: 0 }}>
            {(['all', 'male', 'female'] as const).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGenderFilter(g)}
                style={{
                  padding: '4px 10px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontWeight: 600,
                  textTransform: 'capitalize',
                  border: 'none',
                  backgroundColor: genderFilter === g ? '#FFFFFF' : 'transparent',
                  color: genderFilter === g ? '#0F172A' : '#64748B',
                  boxShadow: genderFilter === g ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                  cursor: 'pointer',
                }}
              >
                {g}
              </button>
            ))}
          </div>
        </div>

        {/* Voice List Scroll Area */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {filteredVoices.map((voice) => {
            const isSelected = draftSelection === voice.id || draftSelection === voice.voiceId;
            const previewUrl = voice.audioUrl || `https://cdn.elevenlabs.io/voices/${voice.voiceId}/preview.mp3`;

            return (
              <div
                key={voice.id}
                onClick={() => setDraftSelection(voice.id)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '14px 16px',
                  cursor: 'pointer',
                  borderRadius: '12px',
                  border: isSelected ? '1.5px solid #6366F1' : '1px solid #E2E8F0',
                  backgroundColor: isSelected ? '#EEF2FF' : '#FFFFFF',
                  boxSizing: 'border-box',
                  transition: 'all 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0, paddingRight: '12px' }}>
                  <div
                    style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '9999px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                      fontSize: '13px',
                      flexShrink: 0,
                      backgroundColor: voice.gender === 'female' ? '#FCE7F3' : '#DBEAFE',
                      color: voice.gender === 'female' ? '#DB2777' : '#2563EB',
                    }}
                  >
                    {voice.name.charAt(0)}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontWeight: 700, fontSize: '13px', color: '#0F172A', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {voice.name}
                      </span>
                      {voice.isCustom && (
                        <span style={{ fontSize: '9px', fontWeight: 700, padding: '1px 5px', backgroundColor: '#FEF3C7', color: '#D97706', borderRadius: '4px' }}>
                          Custom
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: '11px', color: '#64748B', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {voice.description}
                    </span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px' }}>
                      <span style={{ fontSize: '10px', fontWeight: 500, padding: '2px 6px', backgroundColor: '#F1F5F9', color: '#475569', borderRadius: '4px', textTransform: 'capitalize' }}>
                        {voice.gender}
                      </span>
                      {voice.tags?.slice(0, 3).map((tag) => (
                        <span
                          key={tag}
                          style={{ fontSize: '10px', fontWeight: 500, padding: '2px 6px', backgroundColor: '#F1F5F9', color: '#475569', borderRadius: '4px' }}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Preview Audio Play Button */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    togglePlay(voice.id, previewUrl);
                  }}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '8px',
                    fontSize: '11px',
                    fontWeight: 600,
                    border: playingId === voice.id ? 'none' : '1px solid #CBD5E1',
                    backgroundColor: playingId === voice.id ? '#4F46E5' : '#FFFFFF',
                    color: playingId === voice.id ? '#FFFFFF' : '#334155',
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  {playingId === voice.id ? '⏸ Pause' : '▶ Preview'}
                </button>
              </div>
            );
          })}

          {filteredVoices.length === 0 && (
            <div style={{ textAlign: 'center', padding: '30px 0', color: '#94A3B8', fontSize: '12px' }}>
              No matching voices found for "{searchQuery}"
            </div>
          )}

          {/* Custom Voice Add Form Toggle */}
          {onAddCustomVoice && (
            <div style={{ paddingTop: '4px' }}>
              {!showAddCustom ? (
                <button
                  type="button"
                  onClick={() => setShowAddCustom(true)}
                  style={{
                    width: '100%',
                    padding: '10px',
                    border: '1px dashed #CBD5E1',
                    borderRadius: '10px',
                    color: '#475569',
                    fontWeight: 600,
                    fontSize: '12px',
                    backgroundColor: 'transparent',
                    cursor: 'pointer',
                  }}
                >
                  + Add Custom ElevenLabs Voice ID
                </button>
              ) : (
                <form
                  onSubmit={handleCreateCustom}
                  style={{ backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '12px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}
                >
                  <h4 style={{ fontWeight: 700, fontSize: '11px', textTransform: 'uppercase', color: '#475569', margin: 0 }}>
                    Add ElevenLabs Voice
                  </h4>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <input
                      type="text"
                      placeholder="Voice Name (e.g. Marcus)"
                      value={customVoiceName}
                      onChange={(e) => setCustomVoiceName(e.target.value)}
                      style={{ padding: '8px 10px', backgroundColor: '#FFFFFF', border: '1px solid #CBD5E1', borderRadius: '6px', fontSize: '12px' }}
                      required
                    />
                    <input
                      type="text"
                      placeholder="ElevenLabs Voice ID"
                      value={customVoiceId}
                      onChange={(e) => setCustomVoiceId(e.target.value)}
                      style={{ padding: '8px 10px', backgroundColor: '#FFFFFF', border: '1px solid #CBD5E1', borderRadius: '6px', fontSize: '12px' }}
                      required
                    />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', paddingTop: '4px' }}>
                    <button
                      type="button"
                      onClick={() => setShowAddCustom(false)}
                      style={{ padding: '6px 12px', fontSize: '11px', color: '#64748B', backgroundColor: 'transparent', border: 'none', cursor: 'pointer' }}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      style={{ padding: '6px 14px', fontSize: '11px', fontWeight: 600, backgroundColor: '#4F46E5', color: '#FFFFFF', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
                    >
                      Save Voice
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div
          style={{
            padding: '16px 24px',
            borderTop: '1px solid #F1F5F9',
            backgroundColor: '#F8FAFC',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxSizing: 'border-box',
          }}
        >
          <div style={{ fontSize: '12px', color: '#64748B' }}>
            Selected: <span style={{ fontWeight: 700, color: '#0F172A', textTransform: 'capitalize' }}>{draftSelection}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              type="button"
              onClick={() => {
                stopAudio();
                onClose();
              }}
              style={{
                padding: '8px 16px',
                fontSize: '12px',
                fontWeight: 600,
                color: '#475569',
                backgroundColor: '#FFFFFF',
                border: '1px solid #CBD5E1',
                borderRadius: '8px',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              style={{
                padding: '8px 20px',
                backgroundColor: '#4F46E5',
                color: '#FFFFFF',
                fontWeight: 600,
                fontSize: '12px',
                borderRadius: '8px',
                border: 'none',
                cursor: 'pointer',
                boxShadow: '0 2px 4px rgba(79, 70, 229, 0.2)',
              }}
            >
              Apply Voice
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
