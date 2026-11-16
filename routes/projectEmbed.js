/**
 * GET /project/:projectName/embed (NeuroWebLab 1.12.0): what nwl-components'
 * "Embed Project" button frames (ProjectInfo.vue), the embed of the project's
 * first file. From microdraw's app/controller/embed/embed.controller.js
 * (projectEmbed) and BrainBox's controller/project/project-embed.js.
 *
 * The access check is done before redirecting, so that a project the visitor
 * may not see never gives away its file's URL: the app's embed error page
 * instead.
 */
const { catchErrors } = require('../util/catchErrors');

/**
 * The first file of a project's list
 * @param {Object} project A project document
 * @returns {string|null} The first non-empty string of `files.list` (strings,
 *          or `{source}` objects), else null
 */
const firstSource = (project) => {
  const list = (project && project.files && Array.isArray(project.files.list)) ? project.files.list : [];

  return list.map((f) => (typeof f === 'string' ? f : f && f.source))
    .find((s) => typeof s === 'string' && s.length > 0) || null;
};

/**
 * The Express handler of GET /project/:projectName/embed
 * @param {Object} adapter What the app gives
 * @param {function} adapter.findProject (req, shortname) => the project document, or null
 * @param {function} adapter.mayEmbed (req, { source, project }) => { status, message }; 200 lets the visitor in
 * @param {function} adapter.embedURL (source, shortname) => the URL redirected to
 * @param {function} adapter.embedError (res, status, message) => renders the app's embed error page
 * @param {string} adapter.noFilesMessage The 404 message of a project without files
 * @param {string} adapter.serverErrorMessage The 500 message of a thrown error
 * @returns {function} An async Express handler; a thrown error is logged with
 *          `req.log` or `console` and answers 500, unless headers were sent
 */
const projectEmbedRoute = (adapter) => {
  // eslint-disable-next-line max-statements
  const handler = async (req, res) => {
    // framed by other sites, as the embeds themselves
    res.set('Content-Security-Policy', 'frame-ancestors *');

    const project = await adapter.findProject(req, req.params.projectName);
    if (!project) {
      adapter.embedError(res, 404, 'This project could not be found.');

      return;
    }
    const source = firstSource(project);
    if (!source) {
      adapter.embedError(res, 404, adapter.noFilesMessage);

      return;
    }
    const decision = await adapter.mayEmbed(req, { source, project });
    if (decision.status !== 200) {
      adapter.embedError(res, decision.status, decision.message);

      return;
    }
    res.redirect(302, adapter.embedURL(source, project.shortname));
  };

  return catchErrors(handler, (res) => adapter.embedError(res, 500, adapter.serverErrorMessage));
};

module.exports = { projectEmbedRoute, firstSource };
