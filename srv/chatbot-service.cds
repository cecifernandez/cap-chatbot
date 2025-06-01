service ChatbotService @(path: 'chatbot') {
    action chat(message : String, userId : String) returns {
        value : String;
    };
}
