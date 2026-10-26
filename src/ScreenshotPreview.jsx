import { useRef } from 'react';
import { useLanguage } from './language.jsx';

export function ScreenshotPreview({ src, alt }) {
  const dialog = useRef(null);
  const { t } = useLanguage();
  return <>
    <button type="button" className="screenshot-trigger" aria-label={t('Enlarge screenshot')} onClick={() => dialog.current.showModal()}>
      <img src={src} alt={alt} />
    </button>
    <dialog ref={dialog} className="screenshot-dialog" aria-label={t('Screenshot preview')} onClick={event => { if (event.target === dialog.current) dialog.current.close(); }}>
      <div><button type="button" autoFocus onClick={() => dialog.current.close()}>{t('Close screenshot')}</button>
        <img src={src} alt={alt} />
      </div>
    </dialog>
  </>;
}
