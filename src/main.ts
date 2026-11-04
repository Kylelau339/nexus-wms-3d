import './styles/main.css';
import { loadPersistedLang, t } from './core/i18n';
import { SimulationEngine } from './domain/engine';
import { WarehouseScene } from './three/scene';
import { App } from './ui/app';

function fail(message: string, detail?: string): void {
  const boot = document.getElementById('boot');
  if (!boot) return;
  boot.classList.remove('is-hidden');
  boot.innerHTML = `
    <div style="max-width:520px;text-align:center;color:#ff9a9a;font-size:13px;line-height:1.7">
      <div style="font-size:26px;margin-bottom:10px">⚠</div>
      <strong style="display:block;font-size:15px;margin-bottom:8px">${message}</strong>
      ${detail ? `<div style="color:#7f93a8;font-family:var(--mono);font-size:11px">${detail}</div>` : ''}
    </div>`;
}

function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(
      canvas.getContext('webgl2') ??
        canvas.getContext('webgl') ??
        canvas.getContext('experimental-webgl'),
    );
  } catch {
    return false;
  }
}

function boot(): void {
  const canvas = document.getElementById('scene') as HTMLCanvasElement | null;
  if (!canvas) {
    fail(t('無法初始化畫面'), 'missing #scene canvas');
    return;
  }
  if (!supportsWebGL()) {
    fail(
      t('此瀏覽器不支援 WebGL'),
      t('請改用支援 WebGL 2 的 Chrome / Edge / Safari 版本'),
    );
    return;
  }

  try {
    // Restore the operator's language choice before anything is rendered, so the
    // 3D scene and the panels are built in the same language.
    loadPersistedLang();

    const engine = new SimulationEngine(20240101);
    engine.bootstrap();

    const scene = new WarehouseScene(canvas, engine);
    const app = new App(engine, scene);
    app.mount();

    // Drive the WMS simulation from the render loop so 3D and data stay in sync.
    scene.onFrame((dt) => {
      engine.advance(dt);
    });

    scene.start();

    requestAnimationFrame(() => {
      const overlay = document.getElementById('boot');
      if (overlay) {
        overlay.classList.add('is-hidden');
        window.setTimeout(() => overlay.remove(), 700);
      }
    });

    // Expose a small handle for debugging / automation.
    (window as unknown as { nexus: unknown }).nexus = { engine, scene };
  } catch (error) {
    console.error(error);
    fail(t('應用程式初始化失敗'), error instanceof Error ? error.message : String(error));
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
