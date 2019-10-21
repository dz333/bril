import * as bril from './bril';
// import { HashMap, HashSet, Option } from 'prelude-ts';
import { getDominators, findNaturalLoops } from './bril-opt';
import { CFGNode } from './cfg-defs';
import { dfWorklist, liveVars, DFResult } from './bril-df';

function is_loop_invariant(var_name: string, block: CFGNode, reaching_definitions:DFResult<string>) {
    
}

export function eliminateInductionVars(func: CFGNode[]) {
    let dominators = getDominators(func[0]);
    let loops = findNaturalLoops(func, dominators);
    let basic_ind_vars = []
    let reaching_definitions = dfWorklist(func, liveVars);
    for (let loop of loops) {
        for (let block of loop) {
            for (let instr of block.getInstrs()) {
                if (bril.isValueInstruction(instr)) {
                    if (instr.op == "add" || instr.op == "ptradd") {
                        if (instr.args.includes(instr.dest)) {
                            
                        }

                    }

                }
            }
        }
        // find constant variables
        // find instructions of the form v = add v const or v = ptradd v const
    }
}