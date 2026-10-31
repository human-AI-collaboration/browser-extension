document.head.addEventListener("draft-js-content-update", event => {
    const { buttonNumber, content } = event.detail;
    try {
        const editorElement = document.getElementById(`DraftEditor${buttonNumber}`);
        const reactKey = Object.keys(editorElement).find(key =>
            key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$")
        );
        if (!reactKey) throw new Error("React internal instance key not found.");

        const fiberNode = editorElement[reactKey];
        const stateNode = fiberNode.return.stateNode;
        const newContentState = stateNode.props.editorState.getCurrentContent().constructor.createFromText(content);
        const newEditorState = stateNode.props.editorState.constructor.push(stateNode.props.editorState, newContentState, "insert-characters");

        setTimeout(() => {
            stateNode.props.onChange(newEditorState);
        }, 1);
    } catch (error) {
        //console.error("Failed to update Draft.js editor:", error);
    }
});
