/**
 * Born out of a frustration at the number of times an extra commit
 * is needed when the repo location changes. This is especially true
 * of such 'template' repos.
 *
 * Completely hacky and designed to work with git.
 * Any usage beyond that is likely to result in pain.
 * Large dosage Ibuprofen recommended.
 *
 */
const pkg = require('../../package.json');
const chalk = require('chalk');
const gitcfg = require('parse-git-config');
const path = require('path');

/**
 *
 * 'GIt+https://blah-git.git'.replace(/git\+|\+git|\.git/gi, '')
 *  => 'https://blah-git'
 *
 *  'https://user@github.com/user/repo'.replace(/:\/\/([^@]+@)/, '://')
 *  => 'https://github.com/user/repo'
 *
 *  'https://github.com/user/repo'.replace(/:\/\/([^@]+@)/, '://')
 *  => 'https://github.com/user/repo'
 */
function sanitizeGitUrl(url) {
  return url.replace(/git\+|\+git|\.git/gi, '').replace(/:\/\/([^@]+@)/, '://');
}

function pkgRepo(pkg) {
  const type = toString.call(pkg.repository);
  const svcMap = {
    github: 'https://github.com',
    gitlab: 'https://gitlab.com',
    bitbucket: 'https://bitbucket.org'
  };
  switch (type) {
    case '[object String]':
      const parts = pkg.repository.split('/');
      switch (parts.length) {
        case 1:
          throw new Error(`Unsupportted 'package.json:repository' ${pkg.repository}`)
        case 2:
          const svcid = parts[0].split(':')
          const prop = {
            service: svcid.length === 2 ? svcid[0] : 'github',
            userid: svcid.length === 2 ? svcid[1] : svcid[0],
            repo: parts[1]
          }
          return `${svcMap[prop.service]}/${prop.userid}/${prop.repo}`
        default:
          return pkg.repository
      }
    case '[object Object]':
      return pkg.repository.url
  }
}

exports.validate = () => {
  const config = gitcfg.keys(gitcfg.sync());

  if (!(pkg && pkg.repository)) {
    console.log(
      chalk.red(
        `'package.json:repository' is not set.`
      )
    );
    process.exit(-1);
  }

  if (!(config && config.remote && config.remote.origin && config.remote.origin.url)) {
    console.log(
      chalk.red(
        `git remote url is not configured`
      )
    );
    process.exit(-1);
  }

  const repo = {
    name: path.parse(config.remote.origin.url || '').name
  };

  if (pkg.name !== repo.name) {
    console.log(
      chalk.bold.black.bgYellow(
        `CHECK PACKAGE NAME: 'package.json:${pkg.name}' !== 'repository name: ${repo.name}'`
      ));
  }

  const url = {
    pkg: sanitizeGitUrl(pkgRepo(pkg)),
    repo: sanitizeGitUrl(config.remote.origin.url)
  };

  if (url.pkg !== url.repo) {
    console.log(
      chalk.red.bold(
        `Repository name mismatch. 'package.json: ${pkgRepo(pkg)}' !== 'git config: ${config.remote.origin.url}'`
      )
    );
    process.exit(-1);
  }
}
