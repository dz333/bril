#!/usr/bin/env node
import * as bril from './bril';
import { HashMap, HashSet, Option } from 'prelude-ts';
import { AnonymousBlock, BasicBlock, entryLabel, exitLabel,
   TerminatingBlock, CFGNode, DominatorMap, Edge } from './cfg-defs';
import * as df from './bril-df';


function freshName(prefix:string, used:HashSet<string>) {
  let name = "";
  let counter = 0;
  do {
    name = prefix + "_" + counter;
    counter += 1;
  } while (used.contains(name))
  return name;
}

function isTerminator(instr: bril.Instruction): instr is bril.EffectOperation {
  if ('op' in instr) {
    return ["br", "jmp", "ret"].includes(instr.op);
  }
  return false; 
}

function getUsedLabels(func: bril.Function) {
  let result: HashSet<string> = HashSet.empty();
  for (let instr of func.instrs) {
    if ('label' in instr) {
      result = result.add(instr.label);
    }
  }
  return result;
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

  //only add basic blocks if they were labeled
  //or had some instructions in them. If they
  //had instructions but no label, give them a fresh label
  function addBlock(block: AnonymousBlock, usedNames: HashSet<string>) {
    let name = (block.name == null) ? freshName("__block", usedNames) : block.name;
    let newBlock =  {
      name : name,
      idx : block.idx,
      instrs: block.instrs
    };
    if (block.name == null) {
      if (!isEmpty(block)) {
        blocks.push(newBlock);
        return usedNames.add(newBlock.name);
      } else {
        return usedNames;
      }
    } else {
      blocks.push(newBlock);
      return usedNames.add(newBlock.name);
    }
  }
  let cur_block: AnonymousBlock = {name: null, instrs: [], idx: idx}
  let usedNames:HashSet<string> = HashSet.empty();
  for (let func of prog.functions) {
    if (func.name === fname) {
      usedNames = getUsedLabels(func);
      for (let instr of func.instrs) {
        if ('label' in instr) {
          usedNames = addBlock(cur_block, usedNames);
          idx += 1
          cur_block = { name: instr.label, instrs: [], idx: idx}
        } else if (isTerminator(instr)) {
          cur_block.instrs.push(instr)
          usedNames = addBlock(cur_block, usedNames);
          idx += 1
          cur_block = { name: null, instrs: [], idx: idx }
        } else {
          cur_block.instrs.push(instr)
        }
      }
      usedNames = addBlock(cur_block, usedNames);
    }
  }
  blocks.unshift( { name: entryLabel, idx: -1, instrs: [] } );
  blocks.push( {name: exitLabel, idx: blocks.length, instrs:[]} )
  return blocks;
}

function castToTerminator(i: bril.Instruction): bril.EffectOperation {
  switch (i.op) {
    case "jmp":
    case "br":
    case "ret":
      return i;
    default:
      throw `instruction is not terminator!`
  }
}

/**
 * Given an ordered list of BasicBlocks,
 * this adds "return" or "jmp" instructions
 * to the end of any blocks which don't end in terminators.
 * This removes all "fall-through" semantics and allows for
 * basic block re-ordering.
 */
export function addFallThroughTerminators(blocks: BasicBlock[]): TerminatingBlock[] {
  let result:TerminatingBlock[] = [];
  blocks.forEach((b, idx) => {
    let last_instr = (b.instrs.length > 0 ) ? b.instrs[b.instrs.length - 1] : null;
    let next_block = (idx + 1 < blocks.length) ? blocks[idx + 1] : null;
    let termInstr:bril.EffectOperation = { "op" : "ret", "args": [] };
    let instrs = b.instrs;
    if (last_instr == null || !isTerminator(last_instr)) {
      if (next_block == null) {
        termInstr =  { "op" : "ret", "args": [] };
      } else {
        termInstr = { "op" : "jmp", "args": [next_block.name] };
      }
    } else {
      termInstr = castToTerminator(last_instr);
      if (instrs.length > 0) { instrs = instrs.slice(0, instrs.length - 1) }
    }
    result.push ({
      name: b.name,
      instrs: instrs,
      idx: b.idx,
      termInstr: termInstr
    })
  });
  return result;
}

function isEmpty(block: AnonymousBlock) {
  for (let i of block.instrs) {
    if (i.op != "nop") {
      return false;
    }
  }
  return true;
}

function getSuccessors(instr: bril.Instruction): bril.Ident[] {
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

/**
 * Creates a CFG for the given function name only.
 * This creates a list of basic blocks for the given
 * function and then creates a CFG using `createCFG(blocks:BasicBlock[])`.
 * @param fname The function in `prog` to create a CFG for.
 * @param prog The Bril program to analyze.
 */
export function createFunctionCFG(fname: string, prog:bril.Program) {
  let blocks = createBasicBlocks(fname, prog);
  return createCFG(blocks);
}

/**
 * This takes in a list of BasicBlocks,
 * which must be ordered in program text order.
 * It assumes that the first block is the entry point
 * to the program (this is used to eliminate unreachable nodes
 * from the produced graph).
 * 
 * This return a new list of CFGNodes which correspond
 * to these blocks. The order of the returned list
 * corresponds to the order in which these nodes
 * should be serialized to a Bril program.
 * 
 * @param blocks The program-ordered list of basic blocks
 * of the function. These blocks are assumed to use "fall through"
 * semantics, in that a block without a terminator is succeeded
 * by the next block in the list. The first block in the list
 * will be treated as the entry point to the function.
 */
export function createCFG(blocks: BasicBlock[]) {
  let nodeList:CFGNode[] = []
  let termBlocks = addFallThroughTerminators(blocks);
  for (let block of termBlocks) {
    let node:CFGNode = new CFGNode(block.name, block , HashSet.empty(), HashSet.empty());
    nodeList.push(node)
  }
  for (let node of nodeList) {
    let successors:bril.Ident[] = []
    //All blocks must have at least 1 instruction
    let last_instr = node.getTerminator();
    let successorNodes = getNamedNodes(getSuccessors(last_instr), nodeList);
    if (successorNodes.length == 2) {
      node.setSuccessors(successorNodes[0], successorNodes[1], last_instr.args[0]);
    } else if (node.name != exitLabel) {
      node.setSuccessor(successorNodes[0]);
    }
  }
  return removeUnreachableNodes(nodeList[0], nodeList);
}

function removeUnreachableNodes(root:CFGNode, cfg:CFGNode[]) {
  let result = [];
  for (let n of cfg) {
    if (n == root || n.getPredecessors().length() > 0){ 
      result.push(n);
    } else {
      n.delete();
    }
  }
  return result;
}

/**
 * A pretty printer for the CFG that
 * produces a GraphViz-interpretable string.
 * @param fname The function name (i.e. name of the output graph)
 * @param cfg The list of reachable nodes in the cfg of `fname`.
 * @param doms An optional Dominator Map
 */
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

function postorder(root:CFGNode):CFGNode[] {
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

/**
 * This produces a mapping from every reachable node in the graph
 * to all of the nodes which _dominate_ that node.
 * @param root The entry point to the function that this CFG models
 */
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

export interface Loop {
  blocks: HashSet<CFGNode>,
  entry: CFGNode
}
/**
 * 
 * @param cfg 
 * @param doms 
 */
export function findNaturalLoops(cfg: CFGNode[], doms:DominatorMap): Loop[]{
  let backEdges = getBackEdges(cfg, doms);
  let loops = []
  for (let be of backEdges) {
    //remove be.to from Graph
    //find nodes that can reach be.from
    let loop = {
      blocks: getCanReach(be.from, be.to),
      entry: be.to
    }
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
    if (!backEdgeNodes.has(p)) {
      p.replaceEdgeTo(entry, preHeader);
    }
  }
}

/**
 * This iteratively computes live variables
 * and deletes instructions whose writes are never read,
 * until nothing changes. The live variables are
 * used to assist a basic block level code deletion
 * algorithm and are also recomputed every time
 * the program is modified.
 * @param func - The function to optimize
 */
export function eliminateDeadCode(func: CFGNode[]) {
  let changed = true;
  while (changed) {
    changed = false;
    let liveNodes = df.dfWorklist(func, df.liveVars);
    for (let node of func) {
      //have to avoid short circuiting by introducing a new var
      let newChange = eliminateKilledLocals(node, liveNodes.outs.get(node).getOrThrow());
      changed = changed || newChange; 
    }
  }
}

/**
 * Modify the given cfg node to delete any instructions
 * whose results are never read. This comes in two forms:
 * 1) instructions whose destinations are overwritten
 * before being read
 * 2) instructions whose destinations are never read
 * in this block and are not live-outs.
 * 
 * Returns true iff _node_ was changed.
 * @param node The basic block to optimize.
 * @param liveOuts The list of live variables after the
 * execution of this basic block
 */
function eliminateKilledLocals(node: CFGNode, liveOuts: HashSet<string>) {
    let toDrop: HashSet<number> = HashSet.empty();
    let lastDef: HashMap<string, number> = HashMap.empty();
    const instrs = node.getInstrs();
    for (let idx = 0; idx < instrs.length; idx ++) {
      let i = instrs[idx];
      //If an arg is read, remove it
      //from the candidate drop list
      //N.B. need to do this before adding candidates to toDrop
      //b/c of instructions like: a = a + 1 -> this should not drop _a_
      if (bril.isOperation(i)) {
        let args = i.args;
        lastDef = lastDef.filter(k => { return !args.includes(k); });
      }
      if (bril.isValueInstruction(i)) {
        //If the destination of this instruction
        //has been written to but not read, add it
        //to the to-drop list.
        let lastIdx = lastDef.get(i.dest)
        if (lastIdx.isSome()) {
          toDrop = toDrop.add(lastIdx.get());
        }
        lastDef = lastDef.put(i.dest, idx);
      }
    }
    //any lastDefs who are not also live outs
    //and who are not args of the terminator
    //can be droped too
    let termArgs = node.getTerminator().args;
    lastDef.forEach(entry => {
      if (!termArgs.includes(entry[0]) && !liveOuts.contains(entry[0])) {
        toDrop = toDrop.add(entry[1]);
      }});
    let result: bril.Instruction[] = [];
 
    instrs.forEach((i, idx) => {
      if (bril.isValueInstruction(i)) {
        if (!toDrop.contains(idx)) { result.push(i); }
      } else {
        result.push(i);
      }
    })
    node.setInstrs(result);
    return result.length != instrs.length;
}
/**
 * Given a list of CFG nodes for a function, produce the bril function that
 * corresponds to that CFG. The bril text
 * is laid out in the same order as the provided
 * list of nodes.
 * @param fname The name of the function to produce
 * @param nodes The list of nodes in the cfg.
 */
export function cfgToBril(fname: string, nodes: CFGNode[]): bril.Function {
  let instrs:(bril.Instruction | bril.Label)[] = [];
  let retInstr:bril.Instruction = {op: "ret", args:[]};
  for (let n of nodes) {
    if (n.name == entryLabel || n.name == exitLabel) {
      continue; //don't need to synthesize this
    }
    instrs.push( { label: n.name } );
    instrs = instrs.concat(n.getInstrs());
    let succLabels = n.getSuccessors().map( v => {return v.name});
    if (succLabels.contains(exitLabel)) {
      instrs.push(retInstr);
    } else {
      instrs.push(n.getTerminator());
    }
  }
  return { name: fname, instrs: instrs };
}