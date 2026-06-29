// Post-processing pipeline: RenderPass -> BokehPass (DoF) -> OutputPass -> winter grade.
// Numbers come straight from the original (focus 1.4 m, aperture 0.003 desktop
// / 0.006 mobile, maxblur 1).

import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { BokehPass } from "three/examples/jsm/postprocessing/BokehPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";

import { isMobileUA } from "./units";

export const DOF_FOCUS = 1.4;
const DOF_APERTURE_DESKTOP = 0.003;
const DOF_APERTURE_MOBILE = 0.006;
const DOF_MAXBLUR = 1.0;

export interface ComposerBundle {
  composer: EffectComposer;
  bokeh: BokehPass;
  setWinter(amount: number): void;
  setSize(width: number, height: number): void;
  dispose(): void;
}

export function buildComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
): ComposerBundle {
  const composer = new EffectComposer(renderer);

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  const bokeh = new BokehPass(scene, camera, {
    focus: DOF_FOCUS,
    aperture: isMobileUA() ? DOF_APERTURE_MOBILE : DOF_APERTURE_DESKTOP,
    maxblur: DOF_MAXBLUR,
  });
  composer.addPass(bokeh);

  composer.addPass(new OutputPass());

  const winterGrade = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uWinter: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;

      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform float uWinter;
      varying vec2 vUv;

      void main() {
        vec4 source = texture2D(tDiffuse, vUv);
        vec3 color = source.rgb;
        float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
        vec3 dormant = vec3(luminance) * vec3(0.82, 0.87, 0.90);
        float redLead = color.r - color.g;
        float blueGap = color.r - color.b;
        float warmMaterial =
          smoothstep(0.015, 0.11, redLead) *
          smoothstep(0.045, 0.20, blueGap);
        float winterEnvironment = 1.0 - warmMaterial;

        color = mix(color, dormant, winterEnvironment * uWinter);
        color = mix(color, color * vec3(0.94, 0.985, 1.055), uWinter * 0.48);
        gl_FragColor = vec4(color, source.a);
      }
    `,
  });
  composer.addPass(winterGrade);

  function setWinter(amount: number): void {
    winterGrade.uniforms.uWinter.value = THREE.MathUtils.clamp(amount, 0, 1);
  }

  function setSize(width: number, height: number): void {
    composer.setSize(width, height);
  }

  function dispose(): void {
    composer.dispose();
  }

  return { composer, bokeh, setWinter, setSize, dispose };
}
