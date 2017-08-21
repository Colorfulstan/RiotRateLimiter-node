#!/usr/bin/env node
var program = require('commander')
var remapper = require('remap-istanbul')
var cli = require('shelljs-nodecli')
var chalk = require('chalk');
var path = require('path');
var _emoji = require('node-emoji');

var emoji = {
  ok: function() {
    var set = ['sunny', 'showman', 'hearts', 'airplane', 'sparkles', 'golf', 'v', 'star', 'notes', 'clap', 'smile'];
    return _emoji.get(set[parseInt(0.5 + Math.random()*(set.length-1))]);
  },
  warn: function() {
    var set = ['cloud', 'warning', 'zap', 'partly_sunny', 'unamused' ];
    return _emoji.get(set[parseInt(0.5 + Math.random()*(set.length-1))]);
  },
  fail: function() {
    var set = ['skull_and_crossbones', 'radioactive_sign', 'no_entry','x', 'thumbsdown', 'boom' ];
    return _emoji.get(set[parseInt(0.5 + Math.random()*(set.length-1))]);
  }
}

program
  .option('-i, --input <dir>', 'Location of istanbul coverage metrics', './coverage/coverage.json')
  .option('-o, --output <dir>', 'Location of remapped coverage metrics', './coverage/typescript')
  .option('-x, --exclude <pattern>', 'file patterns to exclude from remapping and reporting')
  .option('-f, --force_min_cover <bool>', 'enforce minimum coverage threshold', true)
  .parse(process.argv)


// load the coverage metrics from istanbul run
var cov = remapper.loadCoverage(program.input)
// use source-maps to remap the coverage metrics to typescript
var collector = remapper.remap(cov, {
  exclude: program.exclude || null
})
// generate an jsonhtml report
var json_ofile = path.join(program.output, 'coverage.json')
var force_min_cover = JSON.parse(program.force_min_cover);
remapper
  .writeReport(collector, 'html', {}, program.output)
  .then(function () {
    remapper
      .writeReport(collector, 'json', {}, json_ofile)
      .then(function () {
        console.log('Converting (remapping) coverage reports from JavaScript -> TypeScript\n')
        process.stdout.write('================================== TypeScript ==================================')
        remapper
          .writeReport(collector, 'text-summary')
          .then(function () {
            process.stdout.write('\n')
            console.log('=============================================================================')
            cli.exec(
              'istanbul',
              'check-coverage',
              json_ofile,
              function (code, output) {
                var o = path.resolve(path.join(program.output, 'index.html'))
                console.log('TypeScript coverage report [' + o + ']')
                console.log('=============================================================================')
                console.log('\n')
                if (code === 0) {
                    console.log(
                      chalk.green('Congratulations, this is a well tested repository!')
                      + '  ' + emoji.ok()
                    );
                    process.exit(code);
                } else {
                  if (force_min_cover === true) {
                    console.log(
                      chalk.red(
                        'FAILURE: TypeScript coverage threshold not met. Ninja testing time!'
                      )
                      + '  ' + emoji.fail()
                    );
                    process.exit(code);
                  } else {
                    console.log(
                      chalk.yellow(
                        'WARNING: TypeScript coverage thresholds not satisfied,' +
                          ' Please fix before pushing to remote')
                      + '  ' + emoji.warn() + '\n'
                    );
                    process.exit(0);
                  }
                }
              }
            );
          });
      });
  });

