import * as THREE from "three";
import { BrainFiberTubes } from "./brain-fiber-tubes";
import { clamp, hashUnit } from "./brain-synapse-gpu";

export type DendriteNode = {
  activity: number;
  id: string;
  radius: number;
  weight: number;
  x: number;
  y: number;
  z: number;
};

type DendriteBranch = {
  nodeIndex: number;
  seed: number;
  slot: number;
};

export class BrainDendriteField {
  readonly mesh = new THREE.Group();
  private readonly branches: DendriteBranch[];
  private readonly control = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly end = new THREE.Vector3();
  private readonly endColor = new THREE.Color();
  private readonly glowColor = new THREE.Color(0.52, 0.76, 1);
  private readonly side = new THREE.Vector3();
  private readonly start = new THREE.Vector3();
  private readonly startColor = new THREE.Color();
  private readonly trunks: BrainFiberTubes;
  private readonly twigControl = new THREE.Vector3();
  private readonly twigDirection = new THREE.Vector3();
  private readonly twigEnd = new THREE.Vector3();
  private readonly twigs: BrainFiberTubes;

  constructor(nodes: DendriteNode[], light: boolean) {
    this.branches = [];
    nodes.forEach((node, nodeIndex) => {
      const count = 4 + Math.round(clamp(node.weight, 0, 1) * 3);
      for (let branch = 0; branch < count; branch += 1) {
        this.branches.push({
          nodeIndex,
          seed: hashUnit(`${node.id}:dendrite:${branch}`, 211),
          slot: this.branches.length,
        });
      }
    });
    this.trunks = new BrainFiberTubes(this.branches.length, light, { along: 13, around: 7, shell: 0.7 });
    this.twigs = new BrainFiberTubes(this.branches.length * 2, light, { along: 8, around: 5, shell: 0.42 });
    this.mesh.add(this.trunks.mesh, this.twigs.mesh);
    this.mesh.renderOrder = -0.5;
    this.setOpacity(light ? 0.14 : 0.64);
  }

  setTheme(light: boolean) {
    this.trunks.setTheme(light);
    this.twigs.setTheme(light);
    this.setOpacity(light ? 0.14 : 0.64);
  }

  setOpacity(opacity: number) {
    this.trunks.setOpacity(opacity);
    this.twigs.setOpacity(opacity * 0.72);
  }

  updateColors(nodes: DendriteNode[], nodeTints: Float32Array) {
    for (const branch of this.branches) {
      const node = nodes[branch.nodeIndex];
      if (!node) continue;
      this.startColor.setRGB(
        nodeTints[branch.nodeIndex * 3],
        nodeTints[branch.nodeIndex * 3 + 1],
        nodeTints[branch.nodeIndex * 3 + 2],
      );
      this.endColor.copy(this.startColor).lerp(this.glowColor, 0.2 + branch.seed * 0.16);
      this.trunks.setColors(branch.slot, this.startColor, this.endColor);
      this.trunks.setStrength(branch.slot, 0.58 + node.activity * 0.22 + node.weight * 0.16);
      for (let fork = 0; fork < 2; fork += 1) {
        const twigSlot = branch.slot * 2 + fork;
        this.twigs.setColors(twigSlot, this.endColor, this.startColor);
        this.twigs.setStrength(twigSlot, 0.46 + node.activity * 0.16 + node.weight * 0.12);
      }
    }
    this.trunks.commitColors();
    this.twigs.commitColors();
  }

  updateGeometry(nodes: DendriteNode[]) {
    for (const branch of this.branches) {
      const node = nodes[branch.nodeIndex];
      if (!node) continue;
      const azimuth = hashUnit(`${node.id}:${branch.slot}`, 223) * Math.PI * 2;
      const vertical = hashUnit(`${node.id}:${branch.slot}`, 227) * 2 - 1;
      const ring = Math.sqrt(Math.max(0.0001, 1 - vertical * vertical));
      this.direction.set(Math.cos(azimuth) * ring, vertical, Math.sin(azimuth) * ring).normalize();
      const length = 20 + branch.seed * 30 + node.radius * (1.25 + node.weight * 1.5);
      this.start.set(node.x, node.y, node.z);
      this.end.copy(this.start).addScaledVector(this.direction, length);
      this.side.set(
        hashUnit(`${node.id}:${branch.slot}`, 229) - 0.5,
        hashUnit(`${node.id}:${branch.slot}`, 233) - 0.5,
        hashUnit(`${node.id}:${branch.slot}`, 239) - 0.5,
      ).cross(this.direction);
      if (this.side.lengthSq() < 0.0001) this.side.set(0, 1, 0).cross(this.direction);
      this.side.normalize();
      this.control.copy(this.start)
        .addScaledVector(this.direction, length * (0.48 + branch.seed * 0.12))
        .addScaledVector(this.side, (branch.seed - 0.5) * length * 0.42);
      const trunkRadius = 0.54 + node.weight * 0.46;
      this.trunks.setCurve(
        branch.slot,
        this.start,
        this.control,
        this.end,
        trunkRadius,
        clamp(node.radius * 0.42, 1.15, 3.8),
        0.08,
      );
      for (let fork = 0; fork < 2; fork += 1) {
        const sign = fork === 0 ? -1 : 1;
        const twigSeed = hashUnit(`${node.id}:${branch.slot}:twig:${fork}`, 241);
        const twigLength = length * (0.28 + twigSeed * 0.2);
        this.twigDirection.copy(this.direction)
          .addScaledVector(this.side, sign * (0.42 + twigSeed * 0.36))
          .normalize();
        this.twigEnd.copy(this.end).addScaledVector(this.twigDirection, twigLength);
        this.twigControl.copy(this.end)
          .addScaledVector(this.twigDirection, twigLength * 0.52)
          .addScaledVector(this.side, sign * twigLength * 0.14);
        this.twigs.setCurve(
          branch.slot * 2 + fork,
          this.end,
          this.twigControl,
          this.twigEnd,
          0.24 + twigSeed * 0.16,
          0.52,
          0.025,
        );
      }
    }
    this.trunks.commitGeometry();
    this.twigs.commitGeometry();
  }

  dispose() {
    this.trunks.dispose();
    this.twigs.dispose();
  }
}
