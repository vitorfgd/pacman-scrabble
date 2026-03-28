import * as THREE from 'three'

/**
 * Stylized ocean: mostly blue; FBM varies blue tones; white only as sparse specs (rim/spec/foam).
 * `uCameraPosition` updated each frame from the scene camera.
 */
export function createSimpleWaterShaderMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uCameraPosition: { value: new THREE.Vector3() },
    },
    vertexShader: `
      precision highp float;
      uniform float uTime;
      varying vec3 vWorldPosition;
      varying vec2 vUv;

      void main() {
        vUv = uv;
        vec3 pos = position;
        float t = uTime;
        /* Tiny bob so the plane feels alive without noisy displacement */
        pos.z += sin(pos.x * 0.004 + t * 0.9) * cos(pos.y * 0.004 + t * 0.75) * 0.85;
        vec4 worldPosition = modelMatrix * vec4(pos, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      precision highp float;
      uniform float uTime;
      uniform vec3 uCameraPosition;
      varying vec3 vWorldPosition;
      varying vec2 vUv;

      float hash21(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }

      float vnoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
          mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
          u.y
        );
      }

      float fbm(vec2 p) {
        float v = 0.0;
        float a = 0.52;
        mat2 rot = mat2(1.4, 1.2, -1.2, 1.4);
        for (int k = 0; k < 6; k++) {
          v += a * vnoise(p);
          p = rot * p * 1.95;
          a *= 0.5;
        }
        return v;
      }

      /* Soft posterize: fewer flat steps, still blends a bit */
      float poster(float x, float steps) {
        float s = floor(x * steps + 0.08) / steps;
        return mix(x, s, 0.72);
      }

      void main() {
        float t = uTime;
        vec2 q = vWorldPosition.xy * 0.0072;
        vec2 flow = vec2(t * 0.11, t * 0.08);
        float n0 = fbm(q + flow);
        float n1 = fbm(q * 2.15 - flow * 0.7 + vec2(13.7, 2.4));
        float n2 = fbm(q * 5.2 + flow * 1.3 + n1 * 0.4);
        float ripples = fbm(q * 9.0 + vec2(sin(t * 0.4), cos(t * 0.35)) * 0.6);

        float swell = n0 * 0.58 + n1 * 0.3 + n2 * 0.12;
        swell = poster(swell, 7.0);
        float detail = poster(ripples, 9.0);

        /* Dark blue base ramp (muted navy → mid blue) — no bright cyan */
        vec3 c0 = vec3(0.02, 0.06, 0.16);
        vec3 c1 = vec3(0.04, 0.14, 0.32);
        vec3 c2 = vec3(0.06, 0.22, 0.44);
        vec3 c3 = vec3(0.08, 0.30, 0.52);

        float u = swell * 0.92 + detail * 0.08;
        vec3 col = mix(c0, c1, smoothstep(0.0, 0.42, u));
        col = mix(col, c2, smoothstep(0.35, 0.78, u));
        col = mix(col, c3, smoothstep(0.68, 1.0, u) * 0.55);

        /* Noise → richer blue (same hue family), not white — keeps surface “mostly blue” */
        vec3 cHi = vec3(0.12, 0.36, 0.58);
        float blueLift = smoothstep(0.2, 0.92, swell) * 0.35 + smoothstep(0.3, 0.95, detail) * 0.2;
        col = mix(col, cHi, blueLift * 0.4);

        /* White only: narrow rings + rare high-frequency peaks (inverted from broad wash) */
        float edge = abs(detail - 0.5);
        float ring = smoothstep(0.045, 0.0, edge) * smoothstep(0.09, 0.045, edge);
        float foamAmt = ring * (0.35 + 0.25 * swell);
        foamAmt += pow(max(0.0, n2 - 0.88), 4.5) * 14.0;
        foamAmt += pow(max(0.0, ripples - 0.86), 5.0) * 10.0;
        foamAmt = clamp(foamAmt, 0.0, 1.0);
        vec3 foamRgb = vec3(0.94, 0.98, 1.0);
        col = mix(col, foamRgb, foamAmt * 0.22);

        vec3 viewDir = normalize(uCameraPosition - vWorldPosition);
        vec3 up = vec3(0.0, 0.0, 1.0);
        float ndotv = max(dot(up, viewDir), 0.0);
        float fres = pow(1.0 - ndotv, 2.2);
        fres = smoothstep(0.35, 0.98, fres);
        /* Rim = lighter blue, not white */
        vec3 rim = vec3(0.14, 0.4, 0.62);
        col = mix(col, rim, fres * 0.16);

        vec3 lightDir = normalize(vec3(0.35, 0.45, 1.0));
        float spec = dot(reflect(-viewDir, up), lightDir);
        /* Tight spec = small bright glints */
        spec = smoothstep(0.965, 0.999, spec);
        col += vec3(0.9, 0.96, 1.0) * spec * (0.14 + swell * 0.06);

        float luma = dot(col, vec3(0.299, 0.587, 0.114));
        col = mix(vec3(luma), col, 1.08);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
    depthWrite: true,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 2,
  })
}