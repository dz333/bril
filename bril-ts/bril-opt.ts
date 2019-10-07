#!/usr/bin/env node
import * as bril from './bril';
import { HashMap, HashSet, HasEquals, stringHashCode, Option } from 'prelude-ts';

export interface BasicBlock {
  name: bril.Ident;
  idx: number;
  instrs: (bril.Instruction| bril.Label)[]
}

export type DominatorMap = HashMap<CFGNode, HashSet<CFGNode>>;

export class CFGNode implements HasEquals {

  readonly name: string;
  private block: BasicBlock;
  private successors: HashSet<CFGNode>;
  private predecessors: HashSet<CFGNode>;

  constructor(name: string, block:BasicBlock, successors:HashSet<CFGNode>, predecessors:HashSet<CFGNode>) {
    this.name = name;
    this.block = block;
    this.successors = successors;
    this.predecessors = predecessors;
  }

  addEdgeTo(other:CFGNode) {
    this.successors = this.successors.add(other);
    other.predecessors = other.predecessors.add(this);
  }

  removeEdgeTo(other:CFGNode) {
    this.successors = this.successors.remove(other);
    other.predecessors = other.predecessors.remove(this);
  }

  replaceEdgeTo(originalSucc:CFGNode, newSucc:CFGNode) {
    this.removeEdgeTo(originalSucc);
    this.addEdgeTo(newSucc);
  }

  getBlock() {
    return this.block;
  }

  getSuccessors() {
    return this.successors;
  }

  getPredecessors() {
    return this.predecessors;
  }

  equals(other: CFGNode): boolean {
    return this.name === other.name;
  }

  hashCode(): number {
    return stringHashCode(this.name);
  }
  
  toString(): string {
    return this.name;
  }
}
export interface Edge {
  from: CFGNode;
  to: CFGNode;
}

export const entryLabel = "__entry__";
export const exitLabel = "__exit__";

function isTerminator(instr: bril.Instruction | bril.Label) {
  if ('op' in instr) {
    return ["br", "jmp", "ret"].includes(instr.op);
  }
  return false; 
}

/**
 * Creates an ordered list of blocks from the given
 * Bril progrm, for the specified function, only.
 * All Blocks are given names which are set of the
 * label associated with the beginning of those blocks.
 * If the blocks do not start with a label, then they will
 * be given a fresh name (assuming labels may not start with underscores).
 */
export function createBasicBlocks(fname: string, prog: bril.Program) {
  let blocks: BasicBlock[] = []
  let idx = 0
  let cur_block: BasicBlock = {name: getBlockName(idx), instrs: [ { label: getBlockName(idx)} ], idx: idx}
  for (let func of prog.functions) {
    if (func.name === fname) {
      for (let instr of func.instrs) {
        if ('label' in instr) {
          if (cur_block.instrs.length > 0) { blocks.push(cur_block) }
          idx += 1
          cur_block = { name: instr.label, instrs: [instr], idx: idx}
        } else if (isTerminator(instr)) {
          cur_block.instrs.push(instr)
          blocks.push(cur_block)
          idx += 1
          cur_block = { name: getBlockName(idx), instrs: [ { label: getBlockName(idx)} ], idx: idx }
        } else {
          cur_block.instrs.push(instr)
        }
      }
      if (cur_block.instrs.length > 0 || cur_block.name !== null) {
        blocks.push(cur_block)
      }
    }
  }
  blocks.unshift( { name: entryLabel, idx: -1, instrs: [] } );
  blocks.push( {name: exitLabel, idx: blocks.length, instrs:[]} )
  return blocks;
}

function getBlockName(idx: number): string {
  return "__block" + idx + "__";
}

/**
 * Given an ordered list of BasicBlocks,
 * this adds "return" or "jmp" instructions
 * to the end of any blocks which don't end in terminators.
 * This removes all "fall-through" semantics and allows for
 * basic block re-ordering.
 */
export function addFallThroughTerminators(blocks: BasicBlock[]) {
  blocks.forEach((b, idx) => {
    let last_instr = (b.instrs.length > 0 ) ? b.instrs[b.instrs.length - 1] : null;
    let next_block = (idx + 1 < blocks.length) ? blocks[idx + 1] : null;
    if (last_instr == null || !isTerminator(last_instr)) {
      if (next_block == null) {
        b.instrs.push( { "op" : "ret", "args": []})
      } else {
        b.instrs.push( { "op" : "jmp", "args": [next_block.name] } );
      }
    }
  });
}

function getSuccessors(instr: bril.Instruction|bril.Label): bril.Ident[] {
  if ('op' in instr) {
    switch(instr.op) {
      case "ret": {
        return [exitLabel]
      }
      case "br": {
        return [instr.args[1], instr.args[2]];
      }
      case "jmp": {
        return [instr.args[0]];
      }
    }
  }
  return [];
}

function getNamedNodes(names: bril.Ident[], nodes: CFGNode[]): CFGNode[] {
  let result = []
  for (let n of nodes) {
    if (names.includes(n.name)) {
      result.push(n)
    }
  }
  return result;
}

export function createFunctionCFG(fname: string, prog:bril.Program) {
  let blocks = createBasicBlocks(fname, prog);
  return createCFG(blocks);
}

/**
 * This takes in a list of BasicBlocks,
 * which must be ordered in program text order.
 * This return a new list of CFGNodes which correspond
 * to these blocks. The order of the returned list
 * corresponds to the order in which these nodes
 * should be serialized to a Bril program.
 */
export function createCFG(blocks: BasicBlock[]) {
  addFallThroughTerminators(blocks);
  let nodeList:CFGNode[] = [] 
  for (let block of blocks) {
    let name = (block.name == null) ? "block" + block.idx : block.name
    let node:CFGNode = new CFGNode(name, block , HashSet.empty(), HashSet.empty());
    nodeList.push(node)
  }
  for (let node of nodeList) {
    let successors:bril.Ident[] = []
    for (let instr of node.getBlock().instrs) {
      for (let s of getSuccessors(instr)) {
        successors.push(s)
      }
    }
    for (let n of getNamedNodes(successors, nodeList)) {
      node.addEdgeTo(n);
    }
    if (successors.length == 0 && node.getBlock().idx + 1 < nodeList.length) {
        let nextBlock = nodeList[node.getBlock().idx + 1]
        node.addEdgeTo(nextBlock);
     }
  }
  return nodeList;
}

export function getNamedNode(name: string, cfg:CFGNode[]): CFGNode | null {
  let nodes = getNamedNodes([name], cfg)
  if (nodes.length > 0) {
    return nodes[0]
  } else {
    return null;
  }
}

export function printCFG(fname: string, cfg:CFGNode[], doms: Option<DominatorMap>) {
  let result = "digraph " + fname + " {\n"

  for (let n of cfg) {
    result += "  " + n.name.split(".").join("_") + ";\n"
  }

  for (let n of cfg) {
    for (let succ of n.getSuccessors()) {
      let style = "solid"
      if (doms.isSome() && isBackEdge(n, succ, doms.get())) {
        style = "dashed"
      }
      result += "  " + n.name.split(".").join("_") + " -> " + succ.name.split(".").join("_") + " [style = " + style + "];\n"
    }
  }
  for (let n of cfg) {
    for (let pred of n.getPredecessors()) {
      result += "  " + n.name.split(".").join("_") + " -> " + pred.name.split(".").join("_") + " [color = blue];\n"
    }
  }
  if (doms.isSome()) {
    for (let n of cfg) {
      for (let dom of doms.get().get(n).getOrThrow()) {
        result += " " + n.name.split(".").join("_") + " -> " + dom.name.split(".").join("_") + " [color = red];\n"
      }
    }
  }
  result += "}\n"
  process.stdout.write(result);
  return;
}

export function postorder(root:CFGNode):CFGNode[] {
  let result:CFGNode[] = [];
  postorderHelper(root, HashSet.empty(), result);
  return result;
}

/* Modifies _result_ in place, but returns
 * the set of _explored_ nodes since HashSet<> is an immutable
 * data structure.
 */
function postorderHelper(root:CFGNode, explored: HashSet<CFGNode>, result:CFGNode[]) {
  if (explored.contains(root)) {
      return explored;
  } else {
      explored = explored.add(root);
      for (let s of root.getSuccessors()) {
          explored = postorderHelper(s, explored, result);
      }
      result.push(root);
      return explored;
  }
}

export function getDominators(root:CFGNode) {
  return getDominatorsHelper(postorder(root).reverse());
}

function getDominatorsHelper(blocks:CFGNode[]): DominatorMap {
  let result:DominatorMap = HashMap.empty();
  for (let b of blocks) {
    result = result.put(b, HashSet.ofIterable(blocks));
  }
  let changed = true;
  while(changed) {
    changed = false;
    for (let b of blocks) {
      let doms = HashSet.ofIterable(blocks);
      if (b.getPredecessors().length() == 0) {
        doms = HashSet.empty()
      } else {
        for (let p of b.getPredecessors()) {
          doms = doms.intersect(result.get(p).getOrThrow());
        }
      }
      doms = doms.add(b);
      if (!doms.equals(result.get(b).getOrThrow())) {
        changed = true;
      }
      result = result.put(b, doms);
    }
  }
  return result;
}

function isBackEdge(from: CFGNode, to: CFGNode, doms:DominatorMap) {
  return doms.get(from).getOrThrow().contains(to);
}

function getBackEdges(nodes: CFGNode[], doms:DominatorMap) {
  let result:Edge[] = [];
  for (let n of nodes) {
    let nDoms = doms.get(n).getOrThrow();
    for (let succ of n.getSuccessors()) {
      if (nDoms.contains(succ)) {
        result.push( { from: n, to: succ} );
      }
    }
  }
  return result;
}


function getCanReach(node:CFGNode, without:CFGNode) {
  return getCanReachHelper(node, HashSet.of(without));
}

function getCanReachHelper(node:CFGNode, explored:HashSet<CFGNode>) {
  if (explored.contains(node)) {
    return explored;
  } else {
    explored = explored.add(node);
    for (let p of node.getPredecessors()) {
      explored = getCanReachHelper(p, explored);
    }
    return explored;
  }
}

export function findNaturalLoops(cfg: CFGNode[], doms:DominatorMap) {
  let backEdges = getBackEdges(cfg, doms);
  let loops = []
  for (let be of backEdges) {
    //remove be.to from Graph
    //find nodes that can reach be.from
    let loop = getCanReach(be.from, be.to);
    loops.push(loop);
  }
  return loops;
}

/*
 * Modifies _entry_ so that _preHeader_
 * becomes the sole predecessor of _entry_, excluding
 * back-edges. This must also updates the
 * predecessors of _entry_ to change their
 * successor lists.
 * 
 * _entry_ must be the header of a natural loop
 * _preHeader_ is the CFGNode to insert as the pre-header.
 * _backEdgeNodes_ is the set of predecessors of _entry_ which
 * should not enter the pre-header.
 */
export function addHeader(prog: CFGNode[], entry: CFGNode, preHeader:CFGNode, backEdgeNodes:Set<CFGNode>) {
  let preds = entry.getPredecessors();
  for (let p of preds) { //preds is immutable, we can update entry :)
    //TODO we should modify the removeEdgeTo and addEdgeTo
    //methods so that they modify the corresponding instructions in the basic blocks
    if (!backEdgeNodes.has(p)) {
      p.removeEdgeTo(entry);
      p.addEdgeTo(preHeader);
    }
  }
}

export function cfgToBril(fname: string, nodes: CFGNode[]): bril.Function {
  let instrs:(bril.Label|bril.Instruction)[] = [];
  for (let n of nodes) { 
    instrs = instrs.concat(n.getBlock().instrs);
  }
  return { name: fname, instrs: instrs };
}