#!/usr/bin/env node

import { ArgumentParser } from "argparse";
import { readFile, writeFile } from "./util";
import * as bril from './bril';
import { createFunctionCFG, eliminateDeadCode, cfgToBril } from "./bril-opt";

function optimize(prog: bril.Program, optName: string) {
    if (optName == 'nop') { return }
    for (let f of prog.functions) {
        let cfg = createFunctionCFG(f.name, prog)
        let newInstrs = f.instrs;
        switch (optName) {
            case 'dce':
                eliminateDeadCode(cfg);
                let newf = cfgToBril(f.name, cfg);
                newInstrs = newf.instrs;
                break;
            default:
                throw `unrecognized optimization pass name ${optName}`
        }
        f.instrs = newInstrs;
    }
}

async function main() {
  let parser = new ArgumentParser({
    version: '0.0.1',
    addHelp:true,
    description: 'Runs Bril-based Optimizations'
  });
  parser.addArgument(
    [ '-i', '--input' ],
    {
      help: 'The name of the input BrilJSON file to optimize. If unspecified read from stdin.',
      required: false
    }
  );
  parser.addArgument(
      [ '-n', '--name' ],
      {
          help: 'The name of the optimization to run',
          defaultValue: 'nop',
          choices: ['nop', 'dce']
      }
  );
  parser.addArgument(
      [ '-o', '--output'],
      {
          help: 'The name of the output file to write the resulting Bril into. If unspecified write to stdout.',
          required: false
      }
  );
  let args = parser.parseArgs();

  let inputFileName = args['input'];
  let useStdIn = !inputFileName;
  let outputFileName = args['output'];
  let useStdOut = !outputFileName;
  let passName = args['name'];

  //read input
  let prog = JSON.parse(await readFile(inputFileName, useStdIn)) as bril.Program;
  //do optimization
  optimize(prog, passName);
  //write output
  let output = JSON.stringify(prog, undefined, 2);
  writeFile(output, outputFileName, useStdOut);
}
process.on('unhandledRejection', e => { throw e });
  
main()