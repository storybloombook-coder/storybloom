import { File as ExpoFile, Paths } from 'expo-file-system';
import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import WebView from 'react-native-webview';

// Renders every page of a local PDF to a JPEG using Mozilla's pdf.js inside a
// hidden WebView — no native PDF module needed, so this stays Expo-Go
// compatible (a native rasterizer would require a custom dev build).
// pdf.js runs entirely inside the WebView; only small JSON messages (plus one
// data URL per page) cross the JS bridge via postMessage.

const PDFJS_VERSION = '6.1.200';
const PDFJS_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.mjs`;
const PDFJS_WORKER_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;

type RenderedPage = { uri: string; width: number; height: number };

type Message =
  | { type: 'total'; total: number }
  | { type: 'page'; index: number; dataUrl: string; width: number; height: number }
  | { type: 'done' }
  | { type: 'error'; message: string };

function buildHtml(base64Pdf: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body>
<script type="module">
  import * as pdfjsLib from '${PDFJS_URL}';
  pdfjsLib.GlobalWorkerOptions.workerSrc = '${PDFJS_WORKER_URL}';

  function post(msg) {
    window.ReactNativeWebView.postMessage(JSON.stringify(msg));
  }

  function base64ToUint8Array(b64) {
    const raw = atob(b64);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }

  async function run() {
    try {
      const data = base64ToUint8Array("${base64Pdf}");
      const pdf = await pdfjsLib.getDocument({ data }).promise;
      post({ type: 'total', total: pdf.numPages });
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        await page.render({ canvasContext: ctx, viewport }).promise;
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        post({ type: 'page', index: i, dataUrl, width: canvas.width, height: canvas.height });
        canvas.width = 0;
        canvas.height = 0;
      }
      post({ type: 'done' });
    } catch (e) {
      post({ type: 'error', message: String(e && e.message ? e.message : e) });
    }
  }
  run();
</script>
</body>
</html>`;
}

export default function PdfImporter({
  pdfBase64,
  onProgress,
  onPage,
  onDone,
  onError,
}: {
  // Caller reads the PDF's base64 itself (the new expo-file-system File API
  // can't reliably read files sourced from expo-document-picker in Expo Go —
  // see add-book.tsx's pickFile) and hands it over directly.
  pdfBase64: string | null;
  onProgress: (current: number, total: number) => void;
  onPage: (page: RenderedPage) => void;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    if (!pdfBase64) {
      setHtml(null);
      setTotal(0);
      return;
    }
    setHtml(buildHtml(pdfBase64));
  }, [pdfBase64]);

  if (!html) return null;

  return (
    <WebView
      style={styles.hidden}
      originWhitelist={['*']}
      source={{ html }}
      javaScriptEnabled
      onMessage={(event) => {
        let msg: Message;
        try {
          msg = JSON.parse(event.nativeEvent.data);
        } catch {
          return;
        }
        if (msg.type === 'total') {
          setTotal(msg.total);
          onProgress(0, msg.total);
        } else if (msg.type === 'page') {
          onProgress(msg.index, total);
          const base64 = msg.dataUrl.replace(/^data:image\/\w+;base64,/, '');
          const file = new ExpoFile(Paths.cache, `pdf-page-${Date.now()}-${msg.index}.jpg`);
          file.write(base64, { encoding: 'base64' });
          onPage({ uri: file.uri, width: msg.width, height: msg.height });
        } else if (msg.type === 'done') {
          onDone();
        } else if (msg.type === 'error') {
          onError(msg.message);
        }
      }}
    />
  );
}

const styles = StyleSheet.create({
  hidden: {
    position: 'absolute',
    top: -1000,
    width: 1,
    height: 1,
    opacity: 0,
  },
});
