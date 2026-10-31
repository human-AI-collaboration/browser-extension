# Use an official Python runtime as a parent image
FROM python:3.9-slim

# Set environment variables that Python outputs are sent straight to terminal without buffering
ENV PYTHONDONTWRITEBYTECODE 1
ENV PYTHONUNBUFFERED 1

# Set the working directory in the container to /app
WORKDIR /app

# Copy the server directory contents into the container at /app
COPY . /app/

# Install any needed packages specified in requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Make port 8080 available to the world outside this container
EXPOSE 8080

# Define the command to run the app using gunicorn
CMD ["gunicorn", "-b", "0.0.0.0:8080", "app:app"]