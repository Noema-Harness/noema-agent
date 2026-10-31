const WINDOW_MARGIN = 24;
const MAX_WINDOW_WIDTH = 1240;
const MAX_WINDOW_HEIGHT = 860;
const MINIMUM_RENDERABLE_WIDTH = 320;
const MINIMUM_RENDERABLE_HEIGHT = 420;
const PREFERRED_MINIMUM_WIDTH = 680;
const PREFERRED_MINIMUM_HEIGHT = 560;

/** @param {{width:number,height:number}} workAreaSize */
export function resolveInitialWindowSize(workAreaSize) {
  const width = Math.min(
    MAX_WINDOW_WIDTH,
    Math.max(
      MINIMUM_RENDERABLE_WIDTH,
      Math.floor(workAreaSize.width - WINDOW_MARGIN),
    ),
  );
  const height = Math.min(
    MAX_WINDOW_HEIGHT,
    Math.max(
      MINIMUM_RENDERABLE_HEIGHT,
      Math.floor(workAreaSize.height - WINDOW_MARGIN),
    ),
  );

  return {
    width,
    height,
    minWidth: Math.min(PREFERRED_MINIMUM_WIDTH, width),
    minHeight: Math.min(PREFERRED_MINIMUM_HEIGHT, height),
  };
}

/**
 * @param {{x:number,y:number,width:number,height:number}} bounds
 * @param {{x:number,y:number,width:number,height:number}} workArea
 */
export function fitsWithinWorkArea(bounds, workArea) {
  return (
    bounds.x >= workArea.x &&
    bounds.y >= workArea.y &&
    bounds.x + bounds.width <= workArea.x + workArea.width &&
    bounds.y + bounds.height <= workArea.y + workArea.height
  );
}
