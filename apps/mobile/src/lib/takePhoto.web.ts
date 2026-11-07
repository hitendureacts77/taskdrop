import { pickedFromFile, type PickedMedia } from './media';

/**
 * A photo taken now (City Hunt find, D19), on the web: a file input that asks
 * for the back camera (capture="environment"). Phone browsers open the camera
 * straight away; a desktop browser has no camera picker and shows its file
 * dialog instead, which the web cannot prevent. Must be called straight off a
 * press, or the browser refuses to open it.
 */
export function takePhoto(): Promise<PickedMedia | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.setAttribute('capture', 'environment');
    input.style.display = 'none';
    let settled = false;
    const done = () => {
      settled = true;
      input.remove();
    };
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      done();
      if (!file) return resolve(null);
      pickedFromFile(file, 'image').then(resolve, reject);
    });
    input.addEventListener('cancel', () => {
      if (settled) return;
      done();
      resolve(null);
    });
    document.body.appendChild(input);
    input.click();
  });
}
