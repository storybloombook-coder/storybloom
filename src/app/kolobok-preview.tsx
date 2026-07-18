// kolobok-preview.tsx — dev-only route to test-drive the Kolobok 3D scene
// (features/kolobok/) without touching the real home screen while it's
// still mid-build. Once the scene is far enough along, this is where
// index.tsx gets swapped to render MainScreen directly instead.
import { router, Stack } from 'expo-router';
// features/kolobok is plain JS/JSX by its own CLAUDE.md (no TypeScript
// migration unless asked) -- untyped (implicit any) from Storybloom's side.
import { MainScreen } from '../../features/kolobok/src/MainScreen';

export default function KolobokPreviewScreen() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <MainScreen onNavigate={(route: string) => router.push(route as never)} />
    </>
  );
}
