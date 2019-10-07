#!/usr/bin/env node
import * as bril from './bril';
import * as cfg from './bril-opt';
import { readStdin } from './util';
import { sys } from 'typescript';
import { Option } from 'prelude-ts';


async function main() {
  // Get the Bril filename.
  let prog = JSON.parse(await readStdin()) as bril.Program;
  let blocks = cfg.createBasicBlocks("main", prog);
  if (sys.args.length > 0) {
    process.stdout.write(
      JSON.stringify(blocks, undefined, 2)
    );
    process.stderr.write(
      JSON.stringify({ functions : [cfg.cfgToBril("main", cfg.createCFG(blocks))] }, undefined, 2)
    );
  } else {
    cfg.printCFG("main", cfg.createCFG(blocks), Option.none());
  }
}
process.on('unhandledRejection', e => { throw e });

main()