import * as THREE from "three";

const ALONG = 14;
const AROUND = 6;

const VERTEX = /* glsl */ `
  varying vec3 vColor;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vColor = color;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vNormal = normalize(mat3(modelMatrix) * normal);
    vView = normalize(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uLight;
  uniform float uOpacity;
  varying vec3 vColor;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float facing = abs(dot(normalize(vNormal), normalize(vView)));
    float body = pow(facing, 0.7);
    float rim = pow(1.0 - facing, 2.2);
    vec3 darkBody = mix(vColor * 0.28, mix(vColor, vec3(0.9, 0.97, 1.0), 0.66), body);
    darkBody += vColor * rim * 0.32;
    vec3 lightBody = mix(vColor * 0.7, vColor * 1.18, body);
    vec3 col = mix(darkBody, lightBody, uLight);
    float alpha = uOpacity * mix(0.58 + body * 0.42, 0.72 + body * 0.28, uLight);
    gl_FragColor = vec4(col, alpha);
  }
`;

export class BrainFiberTubes {
  readonly mesh: THREE.Mesh;
  private readonly color: THREE.BufferAttribute;
  private readonly material: THREE.ShaderMaterial;
  private readonly normal: THREE.BufferAttribute;
  private readonly position: THREE.BufferAttribute;
  private readonly side = new THREE.Vector3();
  private readonly tangent = new THREE.Vector3();
  private readonly binormal = new THREE.Vector3();
  private readonly point = new THREE.Vector3();
  private readonly reference = new THREE.Vector3();
  private readonly surface = new THREE.Vector3();

  constructor(private readonly count: number, light: boolean) {
    const verticesPerTube = (ALONG + 1) * AROUND;
    const geometry = new THREE.BufferGeometry();
    this.position = new THREE.BufferAttribute(new Float32Array(count * verticesPerTube * 3), 3);
    this.normal = new THREE.BufferAttribute(new Float32Array(count * verticesPerTube * 3), 3);
    this.color = new THREE.BufferAttribute(new Float32Array(count * verticesPerTube * 3), 3);
    this.position.setUsage(THREE.DynamicDrawUsage);
    this.normal.setUsage(THREE.DynamicDrawUsage);
    this.color.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("position", this.position);
    geometry.setAttribute("normal", this.normal);
    geometry.setAttribute("color", this.color);
    const indices = new Uint32Array(count * ALONG * AROUND * 6);
    let cursor = 0;
    for (let tube = 0; tube < count; tube += 1) {
      const base = tube * verticesPerTube;
      for (let ring = 0; ring < ALONG; ring += 1) {
        for (let side = 0; side < AROUND; side += 1) {
          const nextSide = (side + 1) % AROUND;
          const a = base + ring * AROUND + side;
          const b = base + (ring + 1) * AROUND + side;
          const c = base + (ring + 1) * AROUND + nextSide;
          const d = base + ring * AROUND + nextSide;
          indices[cursor++] = a; indices[cursor++] = b; indices[cursor++] = d;
          indices[cursor++] = b; indices[cursor++] = c; indices[cursor++] = d;
        }
      }
    }
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    this.material = new THREE.ShaderMaterial({
      uniforms: { uLight: { value: light ? 1 : 0 }, uOpacity: { value: light ? 0.14 : 0.36 } },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      // These are closed radial surfaces. Drawing the back faces as well as
      // the front faces doubles additive energy and makes silhouettes pop as
      // the camera rotates across facets.
      side: THREE.FrontSide,
      blending: light ? THREE.NormalBlending : THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 0;
  }

  setTheme(light: boolean) {
    this.material.uniforms.uLight.value = light ? 1 : 0;
    this.material.blending = light ? THREE.NormalBlending : THREE.AdditiveBlending;
    this.material.needsUpdate = true;
  }

  setOpacity(opacity: number) {
    this.material.uniforms.uOpacity.value = opacity;
  }

  setColors(slot: number, start: THREE.Color, end: THREE.Color) {
    const base = slot * (ALONG + 1) * AROUND;
    for (let ring = 0; ring <= ALONG; ring += 1) {
      const t = ring / ALONG;
      const r = start.r + (end.r - start.r) * t;
      const g = start.g + (end.g - start.g) * t;
      const b = start.b + (end.b - start.b) * t;
      for (let side = 0; side < AROUND; side += 1) this.color.setXYZ(base + ring * AROUND + side, r, g, b);
    }
  }

  setCurve(slot: number, start: THREE.Vector3, control: THREE.Vector3, end: THREE.Vector3, radius: number) {
    if (slot < 0 || slot >= this.count) return;
    const base = slot * (ALONG + 1) * AROUND;
    for (let ring = 0; ring <= ALONG; ring += 1) {
      const t = ring / ALONG;
      const inv = 1 - t;
      this.point.set(
        inv * inv * start.x + 2 * inv * t * control.x + t * t * end.x,
        inv * inv * start.y + 2 * inv * t * control.y + t * t * end.y,
        inv * inv * start.z + 2 * inv * t * control.z + t * t * end.z,
      );
      this.tangent.copy(control).sub(start).multiplyScalar(2 * inv).addScaledVector(this.surface.copy(end).sub(control), 2 * t).normalize();
      if (ring === 0) {
        if (slot % 3 === 0) this.reference.set(0, 1, 0);
        else if (slot % 3 === 1) this.reference.set(1, 0, 0);
        else this.reference.set(0, 0, 1);
        if (Math.abs(this.reference.dot(this.tangent)) > 0.96) this.reference.set(this.reference.y, this.reference.z, this.reference.x);
        this.side.crossVectors(this.tangent, this.reference).normalize();
      } else {
        // Parallel-transport the previous ring's frame instead of selecting a
        // fresh world axis. This prevents sudden cross-section flips.
        this.side.addScaledVector(this.tangent, -this.side.dot(this.tangent));
        if (this.side.lengthSq() < 0.000001) this.side.crossVectors(this.tangent, this.reference);
        this.side.normalize();
      }
      this.binormal.crossVectors(this.tangent, this.side).normalize();
      const profile = 0.52 + 0.48 * Math.sin(Math.PI * t);
      for (let side = 0; side < AROUND; side += 1) {
        const angle = (side / AROUND) * Math.PI * 2;
        this.surface.copy(this.side).multiplyScalar(Math.cos(angle)).addScaledVector(this.binormal, Math.sin(angle));
        const at = base + ring * AROUND + side;
        this.position.setXYZ(at, this.point.x + this.surface.x * radius * profile, this.point.y + this.surface.y * radius * profile, this.point.z + this.surface.z * radius * profile);
        this.normal.setXYZ(at, this.surface.x, this.surface.y, this.surface.z);
      }
    }
  }

  commitGeometry() {
    this.position.needsUpdate = true;
    this.normal.needsUpdate = true;
  }

  commitColors() {
    this.color.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
