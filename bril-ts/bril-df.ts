#!/usr/bin/env node
import * as bril from './bril';
import * as cfg from './cfg-defs';
import { HashMap, HashSet, Vector, hasEquals, stringHashCode, HasEquals } from 'prelude-ts';


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

export function setUnion<T>(sets: HashSet<T>[]): HashSet<T> {
    let result: HashSet<T> = HashSet.empty();
    for (let s of sets) {
        result = result.addAll(s.toVector());
    }
    return result;
}

// returns the set of variables in a block that are written to
export function written(block: cfg.CFGNode): HashSet<string> {
    let result: HashSet<string> = HashSet.empty();
    for (let inst of block.getInstrs()) {
        if (bril.isValueInstruction(inst)) {
            result = result.add(inst.dest)
        }
    }
    return result;
}

//get all variables that are used
//before they are written
function used(block: cfg.CFGNode) {
    let localDef = HashSet.empty();
    let used: HashSet<string> = HashSet.empty();
    let instrs = Vector.ofIterable(block.getInstrs()).append(block.getTerminator())
    for (let i of instrs) {
        if (bril.isOperation(i)) {
            let reads: Vector<string> = Vector.empty();
            if (i.op == "br") {
                reads = reads.append(i.args[0]);
            } else if (i.op != "jmp") {
                reads = Vector.ofIterable(i.args);
            }
            for (let a of reads) {
                if (!localDef.contains(a)) {
                    used = used.add(a);
                }
            }
        }
        if (bril.isValueInstruction(i)) {
            localDef = localDef.add(i.dest);
        }
    }
    return used;
}

function addDefined(block: cfg.CFGNode, inVals: HashSet<string>): HashSet<string> {
    return inVals.addAll(written(block).toVector())
}

export let definedVars: DFAnalysis<string> = {
    isForward: true,
    initVal: HashSet.empty(),
    merge: setUnion,
    transfer: addDefined
}

export function getInstructionAt(loc:Location): bril.Instruction {
    return loc.block.getInstrs()[loc.index];
}

export interface Location {
    block: cfg.CFGNode,
    index: number
}

export class Definition implements HasEquals {
    readonly varName: string;
    readonly loc: Location;

    constructor(n: string, l: Location) {
        this.varName = n;
        this.loc = l;
    }

    equals(other: Definition): boolean {
        return this.varName === other.varName &&
        this.loc.block.equals(other.loc.block) &&
        this.loc.index == other.loc.index;
    }

    hashCode(): number {
        return stringHashCode(this.varName + this.loc.block.name + this.loc.index);
    }

}


function reachingTransfer(block: cfg.CFGNode, inVals: HashSet<Definition>): HashSet<Definition> {
    let result = inVals;
    block.getInstrs().forEach((i, idx) => {
        if (bril.isValueInstruction(i)) {
            let def = new Definition(i.dest, { block: block, index: idx } );
            let toRemove = result.filter((d) => {
                return d.varName == i.dest;
            })
            for (let existingDef of toRemove) {
                result = result.remove(existingDef);
            }
            result = result.add(def);
        }
    });
    return result;
}

export let reachingDefinitions: DFAnalysis<Definition> = {
    isForward: true,
    initVal: HashSet.empty(),
    merge: setUnion,
    transfer: reachingTransfer
}

function liveTransfer(block: cfg.CFGNode, outVals: HashSet<string>): HashSet<string> {
    let varsWritten = written(block);
    let varsUsed = used(block);
    return setUnion([varsUsed,outVals.removeAll(varsWritten)]);
}

export let liveVars: DFAnalysis<string> = {
    isForward: false,
    initVal: HashSet.empty(),
    merge: setUnion,
    transfer: liveTransfer
}
