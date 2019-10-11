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
    let defined = df.dfWorklist(graph, df.reachingDefinitions)
    function defToString(d: df.Definition) {
        return d.varName + ": " + d.loc.block.name + "[" + d.loc.index + "]"
    }
    for (let n of graph) {
        process.stderr.write("In[" + n.name + "] = " );
        let ins = defined.ins.get(n);
        if (ins.isSome()) {
            process.stderr.write("{\n\t" + ins.get().map(defToString).mkString("\n\t") + "\n\t}\n");
        } else {
            process.stderr.write("NONE\n");
        }
        process.stderr.write("Out[" + n.name + "] = " );
        let outs = defined.outs.get(n);
        if (outs.isSome()) {
            process.stderr.write("{\n\t" + outs.get().map(defToString).mkString("\n\t") + "\n\t}\n");
        } else {
            process.stderr.write("NONE\n");
        }
    }
}
process.on('unhandledRejection', e => { throw e });
  
main()