# Config

Configuration is specified in a `uni.yml` file at the project root.

For an example project, see the [`uni.yml` file](../example/uni.yml) in the
[example directory](../example).

# `packages`

Map of packages to be published, keyed by name.

## `packages.<package-name>`

`package-name` is of the form `name` or `@scope/name` as specified
by NPM.

### `packages.<package-name>.entrypoint`

**Required**

Path to the code file that exports the public interface of the package.

### `packages.<package-name>.public`

_Default:_ `false`

Setting to true will allow packages to be published to a public registry for
anyone to download.

### `packages.<package-name>.description`

A short description to accompany the package name when published to a registry.

# `dependencies`

A map of dependency package names to their version numbers.

## `dependencies.<dependency-name>: <version>`

This is the package name and version number to depend on, as specified by NPM.

The version number will passthrough to NPM unmodified, but this is an
implementation detail and may change. Therefore, you should avoid using version
ranges or specifiers like `^`.