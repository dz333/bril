import * as bril from './bril';
import { HashMap, HashSet, Option } from 'prelude-ts';
import { getDominators, findNaturalLoops } from './bril-opt';
import { CFGNode } from './cfg-defs';
import { dfWorklist, liveVars, DFResult } from './bril-df';
import { insert } from 'list';

function is_loop_invariant(var_name: string, block:CFGNode, loop: HashSet<CFGNode>, reaching_definitions:DFResult<string>):boolean {
    // a variable is loop invariant if it's reaching definitions are all outside of the loop
    // or it is inside of the loop and it is a write to a constant
    let exist_reaching_inside_block = false;
    for (let loop_block of loop) {
        let reaching_vars = reaching_definitions.ins.get(loop_block);
        reaching_vars.map((reaching_vars) => {
            for (let reaching_var of reaching_vars) {
                if (reaching_var == var_name) {
                    exist_reaching_inside_block = true;
                }
            }
        });
    }
    for (let instr of block.getInstrs()) {
        // overly optimistic
        if (bril.isValueInstruction(instr) && instr.dest == var_name) {
            exist_reaching_inside_block = true;
        }
    }
    if (exist_reaching_inside_block) {
        for (let loop_block of loop) {
            for (let inst of loop_block.getInstrs()) {
                // even if there are multiple constant writes inside of a loop,
                // at any specific point in the loop the value will be loop invariant
                if (bril.isValueInstruction(inst) && inst.dest == var_name && inst.op != "const") {
                    // return false if there is a non-constant write to [var_name]
                    return false;
                }
            }
        }
        return true;
    } else {
        return true;
    }
}

export function eliminateInductionVars(func: CFGNode[]) {
    let dominators = getDominators(func[0]);
    let loops = findNaturalLoops(func, dominators);
    let basic_ind_vars: HashMap<string, bril.ValueInstruction[]> = HashMap.empty();
    let reaching_definitions = dfWorklist(func, liveVars);
    for (let loop of loops) {
        for (let block of loop) {
            for (let instr of block.getInstrs()) {
                if (bril.isValueInstruction(instr)) {
                    if (instr.op == "add" || instr.op == "ptradd") {
                        let dest_index = instr.args.indexOf(instr.dest);
                        if (dest_index != -1) {
                            let other_args = instr.args.slice(0, dest_index).concat(instr.args.slice(dest_index+1));
                            let all_loop_inv = true;
                            for (let arg of other_args) {
                                if (!is_loop_invariant(arg, block, loop, reaching_definitions)) {
                                    all_loop_inv = false;
                                }
                            }
                            if (all_loop_inv) {
                                let instrs_option = basic_ind_vars.get(instr.dest);
                                if (instrs_option.isNone()) {
                                    basic_ind_vars = basic_ind_vars.put(instr.dest, [instr]); 
                                } else if (instrs_option.isSome()) {
                                    let instrs = instrs_option.get();
                                    instrs.push(instr);
                                    basic_ind_vars = basic_ind_vars.put(instr.dest, instrs);
                                }
                            }
                        }

                    }

                }
            }
        }
        // find constant variables
        // find instructions of the form v = add v const or v = ptradd v const
    }

    for (let [var_name, instrs] of basic_ind_vars) {
        if (instrs.length == 1) {
            console.log("Found basic ind variable: " + var_name);
        }
    }
    
}