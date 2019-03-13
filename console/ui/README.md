Developer Console
=================

> The builtin developer UI for Nakama server.

The Developer Console helps developers and studios manage app state, users, storage engine objects, and view active server configuration. All privacy related actions like GDPR export and delete can be initiated from the UI.

The same API used by the dashboard can be used programmatically as an adminstrative REST API.

## Contribute

The project is built with React, React-Router, Redux, and Rbx.

The development roadmap is managed as GitHub issues and pull requests are welcome. Look for issues tagged "console" for existing discussions. If you're interested to enhance the code please open an issue to discuss the changes or drop in and discuss it in the [community chat](https://gitter.im/heroiclabs/nakama).

### Builds

You can start the app locally with `yarn start` in development mode. Visit [http://localhost:3000](http://localhost:3000) to view it in the browser.

To generate a production build use `yarn run build`. It correctly bundles React in production mode and optimizes the build for the best performance.
The build is minified and the filenames include the hashes.

### Special Thanks

Thanks to Devin Fee (@dfee) for the excellent [rbx](https://github.com/dfee/rbx) library.
