# The user and system flow in plain text

## 1. User Initiates Interaction
* User: Sends a message to the chatbot, e.g., "I want to pay my TV subscription."

## 2. System Receives and Processes the Message
* System: Receives the message via a webhook.
* System: Logs the incoming message for debugging purposes.

## 3. Session Management
* System: Extracts the user's phone number from the message.
* System: Checks if a session already exists for the user.
If no session exists, a new session is created.
If a session exists, the session timeout is reset to 10 minutes.

## 4. Extract User Information
* System: Extracts the user's name from the message.
* System: Sanitizes the user message to prevent any injection attacks.
* System: Stores the last user message in the session.

## 5. Use OpenAI GPT-3 to Understand User Intent
* System: Sends the user message to OpenAI's GPT-3 to extract the intent and relevant information.
* System: Receives the response from GPT-3, which includes the extracted intent.

## 6. Determine User Intent and Call Appropriate Function
* System: Checks the extracted intent for keywords:
If the intent includes "pay" and "tv", the system calls the function to handle TV subscription payments.
If the intent includes "pay" and "water", the system calls the function to handle water bill payments.
If the intent includes "pay" and "electricity", the system calls the function to handle electricity bill payments.
If the intent includes "pay" and "prn", the system calls the function to handle PRN payments.
If the intent is "restart", the system calls the function to restart the conversation flow.
If the intent is "/services", the system calls the function to show available services.
If the intent is not recognized, the system calls the function to process the next step in the flow.

## 7. Handle Specific Service Flow
* System: Based on the identified service, the system initiates the corresponding flow:

### TV Subscription Flow:

* System: Asks the user to enter their TV number.
* User: Enters the TV number.
* System: Validates the TV number.
* System: Asks the user to confirm the TV number.
* User: Confirms the TV number.
* System: Asks the user to enter their phone number.
* User: Enters the phone number.
* System: Validates the phone number.
* System: Provides a payment link to the user.


### Water Bill Flow:

* System: Asks the user to enter their water account number.
* User: Enters the water account number.
* System: Validates the water account number.
* System: Asks the user to confirm the water account number.
* User: Confirms the water account number.
* System: Asks the user to enter their email address.
* User: Enters the email address.
* System: Validates the email address.
* System: Provides a payment link to the user.


### Electricity Bill Flow:

* System: Asks the user to enter their meter number.
* User: Enters the meter number.
* System: Validates the meter number.
* System: Asks the user to confirm the meter number.
* User: Confirms the meter number.
* System: Asks the user to enter their phone number.
* User: Enters the phone number.
* System: Validates the phone number.
* System: Provides a payment link to the user.

### PRN Payment Flow:

* System: Asks the user to enter their PRN.
* User: Enters the PRN.
* System: Validates the PRN.
* System: Asks the user to confirm the PRN.
* User: Confirms the PRN.
* System: Asks the user to enter their phone number.
* User: Enters the phone number.
* System: Validates the phone number.
* System: Provides a payment link to the user.

## 8. Handle Fallback and Error Cases
* System: If the user input is not understood, the system provides a fallback response and asks the user to try again or restart the conversation flow.

## 9. Log Active Sessions
* System: Logs the active sessions along with their respective user phone numbers, current services, and last messages.

## 10. Mark Message as Read
* System: Marks the incoming message as read using the WhatsApp API.

## 11. End of Interaction
* System: Ends the interaction and waits for the next user message.

This flow ensures that the chatbot can handle complex user inputs, extract relevant keywords, and call the appropriate functions to process the user's request. Using OpenAI's GPT-3 enhances the chatbot's ability to understand natural language and provide accurate responses.

