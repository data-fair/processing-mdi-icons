# data-fair/processing-mdi-icons

Import Material Design Icons in a data-fair dataset.

## Release

Processing plugins are fetched from the npm registry with a filter on keyword "data-fair-processings-plugin". So publishing a plugin is as simple as publishing the npm package:

```
npm version minor
npm publish
git push && git push --tags
```

To publish a test version, use prerelease versioning with a "test" npm tag:

```
npm version preminor --preid=beta
npm publish --tag=test
git push && git push --tags
```