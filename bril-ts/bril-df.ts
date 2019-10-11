#!/usr/bin/env node
import * as bril from './bril';
import * as cfg from './cfg-defs';
import { HashMap, HashSet, Vector } from 'prelude-ts';


export interface DFAnalysis<T> {
    isForward: boolean,
    initVal: HashSet<T>,
    merge: (sets: HashSet<T>[]) => HashSet<T>,
    transfer: (block: cfg.CFGNode, invals: HashSet<T>) => HashSet<T>
}

export interface DFResult<T> {
    ins: HashMap<cfg.CFGNode, HashSet<T>>,
    outs: HashMap<cfg.CFGNode, HashSet<T>>
}

export function dfWorklist<T>(blocks: cfg.CFGNode[], analysis: DFAnalysis<T>): DFResult<T> {
    function preds(n: cfg.CFGNode) {
        if (analysis.isForward) {
            return n.getPredecessors();
        } else {
            return n.getSuccessors();
        }
    }
    function succs(n: cfg.CFGNode) {
        if (analysis.isForward) {
            return n.getSuccessors();
        } else {
            return n.getPredecessors();
        }
    }
    let firstBlock = blocks[0];
    if (!analysis.isForward) {
        firstBlock = blocks[blocks.length - 1]
    }
    let ins: HashMap<cfg.CFGNode, HashSet<T>> = HashMap.of([firstBlock, analysis.initVal])
    let outs: HashMap<cfg.CFGNode, HashSet<T>> = HashMap.empty();
    let worklist: cfg.CFGNode[] = []
    for (let b of blocks) {
        outs = outs.put(b, analysis.initVal);
        worklist.push(b);
    }
    
    while (worklist.length > 0) {
        let node = worklist[0];
        worklist.shift();
        let inEdges = preds(node);
        let predVals: HashSet<T>[] = []
        for (let pred of inEdges) {
            predVals.push(outs.get(pred).getOrThrow());
        }
        let inVal = analysis.merge(predVals);
        ins = ins.put(node, inVal);
        let outVal = analysis.transfer(node, inVal);
        if (!outVal.equals(outs.get(node).getOrThrow())) {
            outs = outs.put(node, outVal);
            for (let succ of succs(node)) {
                worklist.push(succ);
            }
        }
    }
    if (analysis.isForward) {
        return { ins: ins, outs: outs }
    } else {
        return { ins: outs, outs: ins }
    }
}

function setUnion<T>(sets: HashSet<T>[]): HashSet<T> {
    let result: HashSet<T> = HashSet.empty();
    for (let s of sets) {
        result = result.addAll(s.toVector());
    }
    return result;
}

function addDefined(block: cfg.CFGNode, inVals: HashSet<string>): HashSet<string> {
    let result = inVals;
    for (let inst of block.getInstrs()) {
        if (bril.isValueInstruction(inst)) {
            result = result.add(inst.dest)
        }
    }
    return result;
}

export let definedVars: DFAnalysis<string> = {
    isForward: true,
    initVal: HashSet.empty(),
    merge: setUnion,
    transfer: addDefined
}
