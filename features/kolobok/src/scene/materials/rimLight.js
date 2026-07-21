// rimLight.js — VISUAL_QUALITY_SPEC §2: a fresnel rim injected into hero
// materials via onBeforeCompile. One shared per-frame updater (`useFrame` in
// RimLightSync, mounted once in KolobokScene) walks every registered
// material's uniforms and repaints them from the CURRENT atmosphere palette
// -- this is what ties rim color to time-of-day/weather without each
// character file running its own frame loop for it.

import { useFrame } from '@react-three/fiber/native';
import { Color } from 'three';
import { atmosphereLive } from '../../state/sceneStore';

const registry = []; // [{ uniforms, strength }]

/** Registers a material's rim uniforms (see injectRim below) for the shared
 *  per-frame color/intensity update. `strength` is the material's own fixed
 *  budget from the spec (0.35 characters, 0.2 buildings/stone) -- the LIVE
 *  uRimStrength uniform still gets zeroed when quality.fillLight-style dev
 *  toggles are off, so this is the ceiling, not a per-frame value. */
export function registerRimUniforms(uniforms, strength) {
  registry.push({ uniforms, strength });
}

const warm = (c, amt) => Math.min(1, c + (1 - c) * amt);

/** Mount ONCE in KolobokScene. Not a visual component -- renders nothing. */
export function RimLightSync() {
  useFrame(() => {
    const [hr, hg, hb] = atmosphereLive.horizon;
    // "warmed 20%": nudge each channel 20% of the way toward 1 after
    // biasing red/green up more than blue, i.e. a cheap warm-tint lerp.
    const r = warm(hr, 0.2);
    const g = warm(hg, 0.12);
    const b = warm(hb, 0.04);
    for (const { uniforms, strength } of registry) {
      uniforms.uRimColor.value.set(r, g, b);
      uniforms.uRimStrength.value = strength;
    }
  });
  return null;
}

/** Injects the fragment/vertex additions from VISUAL_QUALITY_SPEC §2 into
 *  any material via onBeforeCompile, and registers its uniforms for the
 *  shared per-frame color update. Works on MeshToonMaterial and
 *  MeshStandardMaterial alike (three.js's compiled shader always carries
 *  `vNormal`; we add our own view-space direction varying rather than
 *  reusing an internal one that might be stripped from the mid-quality
 *  toon shader chunk). */
export function injectRim(material, strength) {
  const uniforms = {
    uRimColor: { value: new Color(1, 1, 1) },
    uRimStrength: { value: strength },
  };

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = uniforms.uRimColor;
    shader.uniforms.uRimStrength = uniforms.uRimStrength;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vRimViewDir;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvRimViewDir = normalize(-(modelViewMatrix * vec4(transformed, 1.0)).xyz);',
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vRimViewDir;\nuniform vec3 uRimColor;\nuniform float uRimStrength;',
      )
      .replace(
        '#include <dithering_fragment>',
        `float rim = 1.0 - max(dot(normalize(vRimViewDir), normalize(normal)), 0.0);
        rim = pow(rim, 2.2) * uRimStrength;
        gl_FragColor.rgb += uRimColor * rim;
        #include <dithering_fragment>`,
      );
  };
  material.needsUpdate = true;

  registerRimUniforms(uniforms, strength);
  return material;
}
