## important notes for developers under windows

use ```npm run sh``` before using the npm scripts!

## Dev quickstart

This documentation and the build tasks would need to be improved,
as the starter repo seems not to be completely up to date and not all changes to it seem to be taken through all tasks.

I am currently using the capabilities of WebStorm to run tests and execute npm tasks,
so this section might take a while to be updated for recommended CLI usage (sorry)

Most important:

For release
```npm run build:dist```

Build upon:

# typescript-starter-node
<!-- badge -->
[![npm license](https://img.shields.io/npm/l/typescript-starter-node.svg)](https://www.npmjs.com/package/typescript-starter-node)
[![travis status](https://img.shields.io/travis/sramam/typescript-starter-node.svg)](https://travis-ci.org/sramam/typescript-starter-node)
[![Build status](https://ci.appveyor.com/api/projects/status/90am2usst4qeutgi?svg=true)](https://ci.appveyor.com/project/sramam/typescript-starter-node)
[![Coverage Status](https://coveralls.io/repos/github/sramam/typescript-starter-node/badge.svg?branch=master)](https://coveralls.io/github/sramam/typescript-starter-node?branch=master)
[![David](https://david-dm.org/sramam/typescript-starter-node/status.svg)](https://david-dm.org/sramam/typescript-starter-node)
[![David](https://david-dm.org/sramam/typescript-starter-node/dev-status.svg)](https://david-dm.org/sramam/typescript-starter-node?type=dev)
<br/>
[![NPM](https://nodei.co/npm/typescript-starter-node.png?downloads=true&downloadRank=true&stars=true)](https://nodei.co/npm/typescript-starter-node/)
<!-- endbadge -->
A starter repository for node modules written in TypeScript.

A simple, full-functionality starter package for node.

Goals:
- minimize dependencies.
- use simpler-to-understand dependencies when necessary.
- enable a move-fast mindset.

# Usage

```
mkdir myApp
cd myApp
git clone https://github.com/sramam/typescript-starter-node
```

Edit package.json and change "name" as appropriate.

```
# For *nix systems, this should work
app=myApp
sed -i 's/\"name\"\s*:\s*\"typescript-starter-node\"/"name": "'"$app"'"/' package.json
```

Once package.json has been properly configured,

```
# remove reference to old repo
rm -rf .git
# initialize a new git repo
git init
# add all the original files back into the
git add . -all
git commit -m "Initial commit"
```
```
# now install all the dependencies.
npm install
npm build
```

At this point, explore ./src for the bare bones example.
Typically, you'd want to delete it's contents, start over and profit!

## Goal
The goal is to be simple, lean and automated.

Support for the following is baked in:

- [x] [tslint](https://github.com/palantir/tslint)
- [x] build automation
- [x] [mocha](https://mochajs.org/) test-automation
- [x] test coverage (remapped to TypeScript)
- [x] checks dependencies for known vulnerabilities before commit.
- [x] CI integration

## DX & minimizing tech-debt
This package take an opinioned view on the Developer-Experience with an eye towards minimizing tech-debt.
There are four operations that will be part of a developer experience:
- `npm build`: cleans, lints, builds and tests with coverage metrics.
- `npm build:dist`: generates distribution artifacts
- `git commit`: a pre-commit hook runs tests with coverage
- `git push`: a pre-push hook runs coverage-check, checks packages for updates and unpatched vulnerabilities

The process is meant to serve as an early-warning mechanism to catch issues that will cause potentially expensive mishaps or re-work later in the project life-cycle.

## run-scripts
Since "lean"-ness is a primary goal, npm is used as a build tool.

The run-scripts used:
*aside:* To help with these, we recommend [npm-completion](https://docs.npmjs.com/cli/completion)?

    clean       : removes all generated directories
    prebuild    : cleans build and runs tslint (for large projects, remove the automatic clean)
    build       : builds the project
    postbuild   : runs tests
    test        : runs tests with coverage on generated JavaScript
    posttest    : remaps coverage report to source TypeScript
    build:watch : watch project files and rebuild when anything changes
    build:dist  : build a distribution (no tests)
    npm-sh      : spawn a new shell with local npm installs in path
    secure      : checks all installed dependencies for vulnerabilities
    check       : checks all installed dependencies for updates
    lcheck      : list dependencies not in compliance with project license requirements
    coverage    : prints coverage report over typescript source

## Structure
The directory structure of a typical project:

    ├── LICENSE
    ├── README.md
    ├── package.json
    ├── scripts
    │   └── remapped-coverage.js
    ├── src
    │   ├── calculator
    │   │   ├── index.ts
    │   │   └── test.ts
    │   ├── greeter
    │   │   ├── index.ts
    │   │   └── test.ts
    │   └── index.ts
    ├── test
    │   └── mocha.opts
    ├── tsconfig.dist.json
    ├── tsconfig.json
    └── tslint.json

In addition, these directories are auto-created by the various scripts. The coverage & build directories are .gitignored. By design, dist directories are - for pure-Type/JavaScript packages, this is an advantage. If your package included native/compiled artifacts, it might need to be reconsidered.

    ├── coverage
    ├── dist
    └── build

### Why are there two tsconfig*.json files?
TypeScript compiler configuration, tsconfig.json does not support multiple build targets. To create separate builds then, one has to use multiple config files and invoke atleast one of them explicitly like we do.

Further, our opinioned preferences is to keep source and associated tests together in the source tree. This requires to compile time configurations - a regular build that includes

## License
Apache-2.0

## Support
Bugs, PRs, comments, suggestions welcomed!

