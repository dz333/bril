#!/usr/bin/env node
import * as bril from './bril';
import * as cfg from './bril-opt';
import * as df from './bril-df';
import { readStdin } from './util';
import { Option } from 'prelude-ts';

async function main() {
    let prog = JSON.parse(await readStdin()) as bril.Program;
    let graph = cfg.createFunctionCFG("main", prog);
    let doms = cfg.getDominators(graph[0]);
    cfg.printCFG("main", graph, Option.some(doms));
    let loops = cfg.findNaturalLoops(graph, doms);
    for (let l of loops) {
        process.stderr.write("Loop: " + l.toString() + "\n");
    }
    let defined = df.dfWorklist(graph, df.definedVars)
    for (let n of graph) {
        process.stderr.write("In[" + n.name + "] = " );
        let ins = defined.ins.get(n);
        if (ins.isSome()) {
            process.stderr.write("{" + ins.get() + "}\n");
        } else {
            process.stderr.write("NONE\n");
        }
        process.stderr.write("Out[" + n.name + "] = " );
        let outs = defined.outs.get(n);
        if (outs.isSome()) {
            process.stderr.write("{" + outs.get() + "}\n");
        } else {
            process.stderr.write("NONE\n");
        }
    }
}
process.on('unhandledRejection', e => { throw e });
  
main()