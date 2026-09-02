import { useEffect, useRef, useState } from "react";
import { HERO } from "../game/config";
import { DEFAULT_CROP, readImageFile } from "../game/player/customFace";
import type { CustomFace } from "../game/player/customFace";
import { drawFace } from "../game/player/suitTexture";

/**
 * Picks the photo that becomes the avatar's face.
 *
 * The preview is the *same* `drawFace` the decal texture is baked with, just at
 * a smaller size, so what the player lines up here is exactly what they wear in
 * the city — including the skin tone the arms and head take from the photo.
 */

const PREVIEW_SIZE = 132;
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

interface FaceUploadProps {
  face: CustomFace | null;
  faceImage: HTMLImageElement | null;
  onChange: (face: CustomFace | null) => void;
}

export function FaceUpload({ face, faceImage, onChange }: FaceUploadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const crop: CustomFace = face ?? { src: "", ...DEFAULT_CROP };
  const { offsetX, offsetY, zoom } = crop;

  useEffect(() => {
    const context = canvasRef.current?.getContext("2d");
    if (!context) return;
    // `drawFace` paints on transparency, because on the avatar the suit shows
    // through around it. Lay the suit red down here so the preview matches.
    const layer = document.createElement("canvas");
    layer.width = PREVIEW_SIZE;
    layer.height = PREVIEW_SIZE;
    const layerContext = layer.getContext("2d");
    if (!layerContext) return;
    drawFace(layerContext, PREVIEW_SIZE, faceImage, { offsetX, offsetY, zoom });
    context.fillStyle = HERO.suitRed;
    context.fillRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE);
    context.drawImage(layer, 0, 0);
  }, [faceImage, offsetX, offsetY, zoom]);

  const pickFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Clear it so picking the same file twice still fires a change event.
    event.target.value = "";
    if (!file) return;
    try {
      onChange({ src: await readImageFile(file), ...DEFAULT_CROP });
      setError(null);
    } catch {
      setError("이미지를 불러오지 못했습니다. 다른 사진을 선택해 주세요.");
    }
  };

  const startDrag = (event: React.PointerEvent<HTMLCanvasElement>) => {
    drag.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const start = drag.current;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    drag.current = { x: event.clientX, y: event.clientY };
    // Dragging the picture right moves the crop window left.
    onChange({
      ...crop,
      offsetX: crop.offsetX - dx / PREVIEW_SIZE / crop.zoom,
      offsetY: crop.offsetY - dy / PREVIEW_SIZE / crop.zoom,
    });
  };

  const endDrag = (event: React.PointerEvent<HTMLCanvasElement>) => {
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const zoomBy = (event: React.WheelEvent<HTMLCanvasElement>) => {
    const next = crop.zoom * Math.exp(-event.deltaY * 0.0015);
    onChange({ ...crop, zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next)) });
  };

  return (
    <div className="face-upload">
      <canvas
        ref={canvasRef}
        className="face-upload__preview face-upload__preview--draggable"
        width={PREVIEW_SIZE}
        height={PREVIEW_SIZE}
        aria-label="아바타 얼굴 미리보기"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onWheel={zoomBy}
      />

      <p className="face-upload__hint">
        {face && "드래그 : 위치 조절 / 휠 : 크기 조절"}
      </p>

      <div className="face-upload__actions">
        <label className="face-upload__button">
          사진 선택
          <input type="file" accept="image/*" onChange={pickFile} hidden />
        </label>
        {face && (
          <button
            type="button"
            className="face-upload__button face-upload__button--ghost"
            onClick={() => {
              onChange(null);
              setError(null);
            }}
          >
            기본 마스크
          </button>
        )}
      </div>

      {error && <p className="face-upload__error">{error}</p>}
    </div>
  );
}
